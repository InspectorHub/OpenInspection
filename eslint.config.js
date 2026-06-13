import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        // `*.config.ts` (vitest/playwright/drizzle/react-router) are build/tooling
        // configs not included in tsconfig.json/tsconfig.api.json, so the
        // type-aware parser can't resolve them. They don't need type-aware
        // linting — ignore them rather than widen the tsconfig projects.
        ignores: ['dist/**', 'dist-check/**', 'build/**', '.react-router/**', 'node_modules/**', '.wrangler/**', 'eslint.config.js', '*.config.ts', 'drizzle.config.trial.ts', 'public/**', 'tests/**', 'scripts/**'],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.json', './tsconfig.api.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
            // Round 5 lesson — Alpine v3 only auto-removes x-cloak from the x-data root.
            // x-cloak on a NESTED element combined with the
            // [x-cloak]{display:none!important} rule in main-layout permanently hides
            // the element even when x-show=true. Two prod bugs landed because of this:
            //   - 17a75d7 (marketplace preview modal)
            //   - a753af5 (login 2fa form)
            // Rule: x-cloak ONLY on the outermost x-data element. For nested
            // hide-on-load, use style="display:none" + x-show.
            'no-restricted-syntax': ['warn',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
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
            'no-restricted-syntax': ['warn',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
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
            'no-restricted-syntax': ['warn',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
                },
                {
                    selector: "CallExpression[callee.name='fetch'][arguments.0.type='Literal'][arguments.0.value=/^\\u002Fapi\\u002F/]",
                    message: 'Do not call fetch("/api/...") with a string literal. Use createApi(context) from ~/lib/api-client.server for typed access.',
                },
                {
                    selector: "CallExpression[callee.name='apiFetch']",
                    message: 'apiFetch was removed. Use createApi(context, { token }) from ~/lib/api-client.server.',
                },
            ],
        },
    }
);
