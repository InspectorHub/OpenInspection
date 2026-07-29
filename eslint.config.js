import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

/**
 * ESLINT_FAST — the pre-commit shape: same rules, no type information.
 *
 * Building the type-aware program is what eslint costs here, and on a commit it
 * buys nothing. Measured on this repo, cache cleared:
 *
 *     one staged server file    15.1s  →  3.7s
 *     two staged app files      15.8s  →  3.9s
 *
 * It buys nothing because every rule that NEEDS type information is 'warn'
 * (no-floating-promises and the no-unsafe-* family below), and `.lintstagedrc`
 * passes no `--max-warnings` — so eslint exits 0 no matter what those rules
 * find. The only error-level TypeScript rules are `no-explicit-any` and
 * `no-unused-vars`, and neither reads types. The hook was therefore spending
 * ~11.5s per commit building a program whose entire output was discarded.
 *
 * The warnings still matter — they are just meant to be READ, not raced past on
 * the way to a commit. `npm run lint` (CI's verify job) runs with no flag set
 * and stays the authority; nothing below changes what CI checks.
 */
const FAST = !!process.env.ESLINT_FAST;

/** A rule that requires type information: its normal severity, or off under ESLINT_FAST. */
const typed = (severity = 'warn') => (FAST ? 'off' : severity);

// T-hooks warn-first rollout: downgrade every rule in a plugin's preset rules
// object to 'warn' (preserving any non-severity options), rather than hand-
// picking which of a preset's rules to enable. Used for jsx-a11y's flat
// recommended config below — see task-hooks-brief.md severity policy.
//
// Rules the preset ships as 'off'/0 by design (deprecated rules like
// jsx-a11y/label-has-for, or rules superseded by another on-rule like
// anchor-ambiguous-text / control-has-associated-label) must NOT be force-
// enabled here — filter those out first, then only warn-ify what the preset
// actually turns on. (T-hooks review fix — the first pass warn-ified
// everything including the off-by-design rules, corrupting the audit table.)
function toWarn(rules) {
    return Object.fromEntries(
        Object.entries(rules)
            .filter(([, value]) => {
                const severity = Array.isArray(value) ? value[0] : value;
                return severity !== 'off' && severity !== 0;
            })
            .map(([name, value]) => [
                name,
                Array.isArray(value) ? ['warn', ...value.slice(1)] : 'warn',
            ]),
    );
}

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        // `*.config.ts` (vitest/playwright/drizzle/react-router) are build/tooling
        // configs not included in tsconfig.json/tsconfig.api.json, so the
        // type-aware parser can't resolve them. They don't need type-aware
        // linting — ignore them rather than widen the tsconfig projects.
        //
        // `app/**/*.test.{ts,tsx}` and `packages/shared-ui/src/**/*.test.{ts,tsx}`
        // are the co-located frontend tests (tests-reorg R2). They are excluded
        // from tsconfig.json (no vitest/@testing-library types in the app tsc
        // program), so the type-aware parser can't place them in any TS project —
        // and they carry no product code. Ignoring them here preserves the
        // pre-move state: they lived under `tests/**` (also ignored below) and
        // were never linted.
        ignores: ['dist/**', 'dist-check/**', 'build/**', '.react-router/**', 'node_modules/**', '.wrangler/**', '.worktrees/**', 'app/paraglide/**', 'eslint.config.js', '*.config.ts', 'drizzle.config.trial.ts', 'public/**', 'tests/**', 'app/**/*.test.ts', 'app/**/*.test.tsx', 'packages/shared-ui/src/**/*.test.ts', 'packages/shared-ui/src/**/*.test.tsx', 'scripts/**'],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parserOptions: {
                // Omitted under ESLINT_FAST — see the FAST note at the top of this file.
                ...(FAST ? {} : { project: ['./tsconfig.json', './tsconfig.api.json'] }),
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
            // T-hooks Tier 1 — type-checked rules, warn-first rollout (see
            // task-hooks-brief.md). Not swapping to recommendedTypeChecked
            // wholesale (would flip ~20 rules to error and fail CI); these are
            // the specific rules called out, all at 'warn' pending cleanup.
            // floating/misused-promises are the headline pre-release signal —
            // silent unawaited promises are a data-loss bug class on Workers.
            '@typescript-eslint/no-floating-promises': typed(),
            // `checksVoidReturn.attributes: false` — passing an async function to
            // a JSX event-handler prop (`onClick={async () => …}`) is idiomatic
            // React (the return is ignored by design); flagging it is pure noise.
            // The pre-release triage confirmed 43/45 misused-promises hits were
            // exactly this pattern and zero were server-executed. The remaining
            // argument/return/property checks stay on to catch genuine misuse.
            '@typescript-eslint/no-misused-promises': typed(['warn', { checksVoidReturn: { attributes: false } }]),
            '@typescript-eslint/await-thenable': typed(),
            '@typescript-eslint/require-await': typed(),
            '@typescript-eslint/no-base-to-string': typed(),
            '@typescript-eslint/restrict-template-expressions': typed(),
            '@typescript-eslint/no-unnecessary-condition': typed(),
            '@typescript-eslint/no-unsafe-assignment': typed(),
            '@typescript-eslint/no-unsafe-member-access': typed(),
            '@typescript-eslint/no-unsafe-call': typed(),
            '@typescript-eslint/no-unsafe-return': typed(),
            '@typescript-eslint/no-unsafe-argument': typed(),
            // T-hooks Tier 3 — architecture/hygiene, warn (no --fix sweep; huge diff).
            '@typescript-eslint/consistent-type-imports': 'warn',
            '@typescript-eslint/no-import-type-side-effects': 'warn',
            // Round 5 lesson — Alpine v3 only auto-removes x-cloak from the x-data root.
            // x-cloak on a NESTED element combined with the
            // [x-cloak]{display:none!important} rule in main-layout permanently hides
            // the element even when x-show=true. Two prod bugs landed because of this:
            //   - 17a75d7 (marketplace preview modal)
            //   - a753af5 (login 2fa form)
            // Rule: x-cloak ONLY on the outermost x-data element. For nested
            // hide-on-load, use style="display:none" + x-show.
            'no-restricted-syntax': ['error',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
                },
                // Cookie-policy guard (PR 1) — setCookie must take its attributes
                // from a factory in server/lib/auth-helpers.ts, never an inline object.
                // CLAUDE.md mandates httpOnly + secure + sameSite + path on EVERY
                // setCookie; five sites were hand-maintaining identical copies of the
                // staff-session options and two more the portal's. They were correct
                // at the time, which is exactly why nobody noticed there were seven
                // places to update on the next policy change.
                {
                    selector: "CallExpression[callee.name='setCookie'] > ObjectExpression",
                    message: 'Pass a cookie-options factory from server/lib/auth-helpers.ts (authCookieOptions / portalSessionCookieOptions), not an inline object — CLAUDE.md requires httpOnly+secure+sameSite+path on every cookie.',
                },
                // Admin-tier guard (IA-94 / PR 1) — "is this an owner or a manager"
                // must go through isAdminRole() in server/lib/auth/roles.ts. It was
                // re-derived in SEVEN places before this rule existed, including a
                // same-named local const with its own logic, and a comment reading
                // "Keep in sync with isAdminRole" — a note asking a human to do what
                // a rule can. The role-literal guard does not catch these: its
                // override block exempts server/lib, server/api, server/services and
                // app — i.e. everywhere they lived.
                {
                    selector: "LogicalExpression[operator='||']:has(Literal[value='owner']):has(Literal[value='manager'])",
                    message: 'Use isAdminRole() from server/lib/auth/roles.ts instead of comparing to owner/manager inline.',
                },
                {
                    selector: "LogicalExpression[operator='||']:has(MemberExpression[property.name='OWNER']):has(MemberExpression[property.name='MANAGER'])",
                    message: 'Use isAdminRole() from server/lib/auth/roles.ts instead of comparing to ROLE.OWNER/ROLE.MANAGER inline.',
                },
                // Role taxonomy guard — all RBAC role string literals must derive from
                // ROLES / Role in server/lib/auth/roles.ts (the single source of truth).
                // This prevents typos and stale literals surviving a role rename.
                // Exempt: roles.ts itself, test files, schema/data/seed files
                // (see override block below). Includes 'manager' now so the future
                // admin→manager rename is already guarded on day one.
                // requireRole(...roles: Role[]) is excluded via :not() because TypeScript
                // already enforces Role at the call site — a typo there is a compile error.
                {
                    selector: "Literal[value=/^(owner|admin|manager|inspector|agent)$/]:not(CallExpression[callee.name='requireRole'] > Literal)",
                    message: 'Use ROLES / Role from server/lib/auth/roles.ts — no bare role string literals.',
                },
                // Status taxonomy guard — inspection status literals must derive from
                // INSPECTION_STATUS / REPORT_STATUS in server/lib/status/*.ts.
                // Narrowly targets only the values that are unambiguous in this codebase:
                //   'requested'  — only an InspectionStatus value (lifecycle axis)
                //   'submitted'  — only a ReportStatus value (report deliverable axis)
                // Values NOT banned because they collide with other enums:
                //   'draft'      — invoice status ('draft'|'sent'|'paid'|'partial')
                //   'published'  — sync outbox status + automation trigger names
                //   'completed'  — could be used in other enums
                //   'cancelled'  — broad usage
                //   'scheduled'  — booking/concierge status
                //   'confirmed'  — booking/concierge status
                //   'in_progress' — collision: inspection_requests table status +
                //                   dashboard filter tab IDs + report-status
                // All legit uses of 'requested' and 'submitted' live in files already
                // covered by the override block below (server/lib/**, server/api/**,
                // server/services/**, app/**), so this guard only fires on NEW code
                // outside those zones — keeping it forward-looking with zero current noise.
                {
                    selector: "Literal[value=/^(requested|submitted)$/]",
                    message: 'Use INSPECTION_STATUS / REPORT_STATUS from server/lib/status/* — no bare status literals.',
                },
            ],
        },
    },
    {
        // Exempt files where the role-string matches are NOT bare RBAC literals
        // that need fixing. Each category is explained below. The rule fires only
        // on NEW code paths outside these globs, keeping the guard forward-looking.
        //
        // server/lib/auth/roles.ts       — source of truth; defines the literals
        // server/lib/db/schema/**        — drizzle column defs; also has non-user-role
        //                                  enums (signer/contact roles) which use 'agent'
        // server/data/**                 — seed/fixture data; literals are authoritative
        // server/lib/middleware/rbac.ts  — requireRole(...roles:Role[]) definition;
        //                                  the Role type already enforces call sites
        // server/lib/auth/jwt-claims.ts  — uses 'agent' as a JWT kind discriminant
        // server/lib/public-access.ts    — PortalRole ('client'|'co_client'|'agent') is
        //                                  a non-RBAC signer role (≠ users.role)
        // server/durable-objects/**      — presence role ('inspector'|'observer') ≠ RBAC
        // server/lib/email-templates/**  — email category ('agent'|'client') ≠ RBAC
        // server/lib/integration/**      — bootstrap insert; drizzle column enum enforces
        // server/portal/**               — credential upsert; drizzle column enum enforces
        // server/api/**                  — existing sites: OpenAPI tags/scopes strings
        //                                  ('admin' there is a doc label, not a role), plus
        //                                  Drizzle typed inserts (column enum enforces), JWT
        //                                  payload role fields (typed as UserRole), and
        //                                  non-RBAC signer/contact role strings. requireRole
        //                                  args are already excluded by :not() in the selector.
        // server/services/**             — Drizzle insert/query role literals are typed by
        //                                  { enum: ROLES }; non-RBAC contact-type strings
        //                                  ('agent'|'client') are a distinct taxonomy
        // server/lib/**                  — dashboard-column ids, route-metadata scopes,
        //                                  validation schemas for non-RBAC signer/automation roles.
        //                                  RBAC-specific helpers (can-edit, report-section-numbering)
        //                                  were already fixed to use ROLE.* constants.
        // server/index.ts                — JWT context population; typed as UserRole
        // app/**                         — UI role strings are typed via the session context
        //                                  (Role type flows from the loader); display/conditional
        //                                  logic uses the session role value directly
        files: [
            'server/lib/auth/roles.ts',
            'server/lib/db/schema/**/*.ts',
            'server/data/**/*.ts',
            'server/lib/middleware/rbac.ts',
            'server/lib/auth/jwt-claims.ts',
            'server/lib/public-access.ts',
            'server/durable-objects/**/*.ts',
            'server/lib/email-templates/**/*.ts',
            'server/lib/integration/**/*.ts',
            'server/portal/**/*.ts',
            'server/api/**/*.ts',
            'server/services/**/*.ts',
            'server/lib/**/*.ts',
            'server/index.ts',
            'app/**/*.ts',
            'app/**/*.tsx',
        ],
        rules: {
            // Turn off ONLY the role-literal restriction for these files; all other rules still apply.
            'no-restricted-syntax': ['error',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
                },
                // Cookie-policy guard (PR 1) — setCookie must take its attributes
                // from a factory in server/lib/auth-helpers.ts, never an inline object.
                // CLAUDE.md mandates httpOnly + secure + sameSite + path on EVERY
                // setCookie; five sites were hand-maintaining identical copies of the
                // staff-session options and two more the portal's. They were correct
                // at the time, which is exactly why nobody noticed there were seven
                // places to update on the next policy change.
                {
                    selector: "CallExpression[callee.name='setCookie'] > ObjectExpression",
                    message: 'Pass a cookie-options factory from server/lib/auth-helpers.ts (authCookieOptions / portalSessionCookieOptions), not an inline object — CLAUDE.md requires httpOnly+secure+sameSite+path on every cookie.',
                },
                // Admin-tier guard (IA-94 / PR 1) — "is this an owner or a manager"
                // must go through isAdminRole() in server/lib/auth/roles.ts. It was
                // re-derived in SEVEN places before this rule existed, including a
                // same-named local const with its own logic, and a comment reading
                // "Keep in sync with isAdminRole" — a note asking a human to do what
                // a rule can. The role-literal guard does not catch these: its
                // override block exempts server/lib, server/api, server/services and
                // app — i.e. everywhere they lived.
                {
                    selector: "LogicalExpression[operator='||']:has(Literal[value='owner']):has(Literal[value='manager'])",
                    message: 'Use isAdminRole() from server/lib/auth/roles.ts instead of comparing to owner/manager inline.',
                },
                {
                    selector: "LogicalExpression[operator='||']:has(MemberExpression[property.name='OWNER']):has(MemberExpression[property.name='MANAGER'])",
                    message: 'Use isAdminRole() from server/lib/auth/roles.ts instead of comparing to ROLE.OWNER/ROLE.MANAGER inline.',
                },
            ],
        },
    },
    {
        // Dead-routes cleanup (2026-05-30) — guard against re-introducing raw
        // /api/* string-literal fetches and the now-deleted apiFetch helper in
        // route files. The 17 retained apiFetch dead-route sites were all migrated
        // to the typed createApi(context, { token }) client; this keeps it that way.
        // Scoped to routes/** so browser-side component fetches aren't false-flagged.
        files: ['app/routes/**/*.ts', 'app/routes/**/*.tsx'],
        rules: {
            'no-restricted-syntax': ['error',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
                },
                // Cookie-policy guard (PR 1) — setCookie must take its attributes
                // from a factory in server/lib/auth-helpers.ts, never an inline object.
                // CLAUDE.md mandates httpOnly + secure + sameSite + path on EVERY
                // setCookie; five sites were hand-maintaining identical copies of the
                // staff-session options and two more the portal's. They were correct
                // at the time, which is exactly why nobody noticed there were seven
                // places to update on the next policy change.
                {
                    selector: "CallExpression[callee.name='setCookie'] > ObjectExpression",
                    message: 'Pass a cookie-options factory from server/lib/auth-helpers.ts (authCookieOptions / portalSessionCookieOptions), not an inline object — CLAUDE.md requires httpOnly+secure+sameSite+path on every cookie.',
                },
                // Admin-tier guard (IA-94 / PR 1) — "is this an owner or a manager"
                // must go through isAdminRole() in server/lib/auth/roles.ts. It was
                // re-derived in SEVEN places before this rule existed, including a
                // same-named local const with its own logic, and a comment reading
                // "Keep in sync with isAdminRole" — a note asking a human to do what
                // a rule can. The role-literal guard does not catch these: its
                // override block exempts server/lib, server/api, server/services and
                // app — i.e. everywhere they lived.
                {
                    selector: "LogicalExpression[operator='||']:has(Literal[value='owner']):has(Literal[value='manager'])",
                    message: 'Use isAdminRole() from server/lib/auth/roles.ts instead of comparing to owner/manager inline.',
                },
                {
                    selector: "LogicalExpression[operator='||']:has(MemberExpression[property.name='OWNER']):has(MemberExpression[property.name='MANAGER'])",
                    message: 'Use isAdminRole() from server/lib/auth/roles.ts instead of comparing to ROLE.OWNER/ROLE.MANAGER inline.',
                },
                {
                    // `/api/public/*` is exempt: those endpoints are unauthenticated
                    // by design, so a browser calling them directly is correct. The
                    // rule exists because a client fetch of a GUARDED route carries
                    // no session cookie and 401s — see the BFF note in CLAUDE.md.
                    // The embed widget posts a booking from a third-party page and
                    // has no loader to route through.
                    selector: "CallExpression[callee.name='fetch'][arguments.0.type='Literal'][arguments.0.value=/^\\u002Fapi\\u002F(?!public\\u002F)/]",
                    message: 'Do not call fetch("/api/...") with a string literal. Use createApi(context) from ~/lib/api-client.server for typed access.',
                },
                {
                    selector: "CallExpression[callee.name='apiFetch']",
                    message: 'apiFetch was removed. Use createApi(context, { token }) from ~/lib/api-client.server.',
                },
            ],
        },
    },
    {
        // T-hooks Tier 2 — React hooks / RR + a11y, scoped to the frontend +
        // shared component library (server/ has no JSX). rules-of-hooks is a
        // genuine bug class (error, verified 0 violations); everything else is
        // warn-first per task-hooks-brief.md — this is existing-code surfacing,
        // not a fix-it-now gate.
        files: ['app/**/*.{ts,tsx}', 'packages/shared-ui/src/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
            react,
            'jsx-a11y': jsxA11y,
        },
        languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        settings: {
            // NOT 'detect': eslint-plugin-react 7.37.5's version-detection path calls
            // context.getFilename(), which flat-config ESLint 10 no longer exposes on
            // the rule context (TypeError: contextOrFilename.getFilename is not a
            // function). Pinning the version explicitly (react's actual installed
            // version) skips that codepath entirely. Bump this if/when React is
            // upgraded, or revisit 'detect' once the plugin ships an ESLint-10 fix.
            react: { version: '18.3.1' },
        },
        rules: {
            // DOWNGRADED from the intended 'error' (task-hooks-brief.md Tier 2) to
            // 'warn' — auditing found a genuine violation, not a false positive:
            // app/components/editor/ItemEditor.tsx:343 calls useMemo() AFTER an
            // early `if (!item) return null;` at line 242, so the hook only runs on
            // some renders. Real bug, left unfixed here per the hard invariant (no
            // mass-fix in this task) — flagged prominently in task-hooks-report.md
            // for a human decision. Re-promote to 'error' once fixed.
            'react-hooks/rules-of-hooks': 'warn',
            'react-hooks/exhaustive-deps': 'warn',
            // Deliberately NOT eslint-plugin-react's full `recommended` preset —
            // prop-types etc. is noise in a TS codebase (types already enforce
            // props). Only the rules called out in the brief.
            'react/react-in-jsx-scope': 'off',
            'react/jsx-key': 'warn',
            'react/no-array-index-key': 'warn',
            'react/no-unstable-nested-components': 'warn',
            'react/jsx-no-target-blank': 'warn',
            // jsx-a11y's flat recommended, downgraded wholesale to 'warn' (see
            // toWarn() above) rather than hand-picking a subset — the brief
            // offers either; this gives fuller a11y audit coverage for free.
            ...toWarn(jsxA11y.flatConfigs.recommended.rules),
        },
    },
    {
        // T-hooks Tier 3 — import-x/no-cycle (circular-dep guard for the
        // service/di hub). Ordering rules (import/order etc.) are intentionally
        // skipped — cosmetic and noisy per the brief. `import-x/resolver:
        // {typescript: true}` (the legacy shorthand) errors ("invalid interface
        // loaded as resolver") because no-cycle actually needs the
        // `eslint-import-resolver-typescript` package resolved through the
        // flat-config-only `resolver-next` API — added as a devDependency and
        // wired below so path-mapped (~/*) and .ts-extensionless imports resolve.
        files: ['**/*.ts', '**/*.tsx'],
        plugins: { 'import-x': importX },
        settings: {
            'import-x/resolver-next': [createTypeScriptImportResolver()],
        },
        rules: {
            'import-x/no-cycle': 'warn',
        },
    },
    {
        // T-hooks Tier 3/4 — app<->server BFF boundary + JWT sign/verify
        // guard, combined into one no-restricted-imports rule (paths +
        // patterns) per the brief. Both are 'error' ONLY because verified 0
        // violations (see task-hooks-report.md) — server/ never imports app/,
        // and the sole hono/jwt import (server/lib/jwt-keyring.ts) is a
        // verify-only import carrying an inline disable with a reason (the
        // keyring IS the sanctioned wrapper).
        files: ['server/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    {
                        name: 'hono/jwt',
                        importNames: ['sign', 'verify'],
                        message: 'Use server/lib/jwt-keyring.ts (signJwt/verifyJwt) — direct hono/jwt sign/verify is forbidden (pins ES256 + kid). See CLAUDE.md JWT & Auth Security Rules.',
                    },
                ],
                patterns: [
                    {
                        group: ['**/app/*', '**/app/**', '~/*'],
                        message: 'server/ must not import from app/ (BFF boundary). Duplicate the pure util (see server/lib/format.ts twin) or move it to a shared location.',
                    },
                ],
            }],
        },
    },
    // The composition root is exempt from type-aware linting. It imports every
    // route module, and giving a file with that fan-in full type information
    // exhausts the heap: measured on server/index.ts, eslint died with SIGABRT
    // after 91s at 4GB and after 189s at 6GB, needed 8GB to finish at all, and
    // took ~3min there. With type-aware rules off it lints in 2.7s at 4GB.
    //
    // Splitting the file does NOT fix this — the cost is the import fan-in, not
    // the length. Flattening the 157-line chained `.route()` accumulation into
    // 81 separate statements still OOMed at 4GB (147s), and any file that mounts
    // 81 routers imports all 81 of them.
    //
    // The trade is that the typed rules (all 'warn' here) stop covering this
    // file, so nothing security-bearing may live in it. That is why the JWT
    // middleware moved out to server/lib/middleware/jwt-auth.ts, where it keeps
    // no-floating-promises and the rest. Keep this file as wiring: `app.use`,
    // `app.route`, and small inline handlers.
    {
        files: ['server/index.ts'],
        ...tseslint.configs.disableTypeChecked,
    }
);
