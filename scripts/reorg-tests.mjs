#!/usr/bin/env node
/**
 * One-shot tests/ reorganization (2026-07 plan: docs/superpowers/plans/2026-07-03-oi-tests-reorg.md).
 *
 * Moves specs into the R1/R2 layout via `git mv` and rewrites relative import
 * specifiers by the depth delta of each move. Dry-run by default; refuses to
 * proceed if any unit spec has no mapping (no silent leftovers).
 *
 *   node scripts/reorg-tests.mjs                      # dry-run, all scopes
 *   node scripts/reorg-tests.mjs --apply --scope unit # execute one scope
 *
 * Scopes: unit (domain buckets) | e2e (merge all Playwright specs into
 * tests/e2e) | web (co-locate frontend tests into app/).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, posix, dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const scopeArg = process.argv.indexOf('--scope');
const SCOPE = scopeArg > -1 ? process.argv[scopeArg + 1] : 'all';
const root = process.cwd();

// ---------------------------------------------------------------------------
// R2 mapping: ordered [regex-on-basename, targetDir-under-tests/unit].
// First match wins. Order matters (e.g. usage/metering before email/sms).
const EXPLICIT = {
    // ambiguous names pinned by hand (reviewed in dry-run):
    'portal-isolation.spec.ts': 'sync',
    // NOT the real-estate "agents" (AgentService referral-partner) domain —
    // this tests syncInspectionAssignments/-Batch (inspectionInspectors
    // lead/helper rows), consumed by server/api/inspections/core.ts and the
    // booking/concierge/inspection-request write paths. Belongs with inspections.
    'assignment-links.spec.ts': 'inspections',
    // Tests AttachedRecommendationItemSchema (contractorTypeSnapshot on an
    // attached recommendation) — same attached-recommendation-item shape as
    // aggregate-recommendations.spec.ts, which RULES already sends to
    // 'comments' (the recommendations/contractor-type home per the
    // comments-repair fold). Keep the pair together, not in 'repair'.
    'aggregate-contractor-snapshot.spec.ts': 'comments',
    'iter2-bug9-sign-redirect.spec.ts': 'agreements',
    // Tests ImportHistoryService against tenantMarketplaceImportHistory
    // (template/library install/update/replace/migrate rows) — this is
    // marketplace template-import history, not inspection content.
    'import-history.service.spec.ts': 'marketplace',
    'tag.service.spec.ts': 'inspections',
    'subsystem-b-results-shape-tolerance.spec.ts': 'inspections',
    'event.service.spec.ts': 'calendar',
    'team-invite.service.spec.ts': 'tenancy',
    'audit-inspector-slug.spec.ts': 'tenancy',
    'audit-inspector-slug-schema.spec.ts': 'tenancy',
    'audit-log-service.spec.ts': 'platform',
    'widget.service.spec.ts': 'bookings',
    'service-inspectors.spec.ts': 'bookings',
    'qbo-crypto.spec.ts': 'secrets',
    'mustache.spec.ts': 'platform',
    'icons.spec.ts': 'platform',
    'pdf.spec.ts': 'reports',
    'resolve.spec.ts': 'tenancy',
    'preflight.spec.ts': 'platform',
    'sanity.spec.ts': 'platform',
    'sitename-init.spec.ts': 'platform',
    'setup-wizard-mount.spec.ts': 'platform',
    'wizard-schema.spec.ts': 'platform',
    'profile-schema.spec.ts': 'auth',
    'resolve-provider.spec.ts': 'messaging',
    // free-tier usage-quotas (2026-07-02/2026-07-03 specs) — names don't carry
    // a usage-/quota- prefix RULES can key on:
    'estimate-range.spec.ts': 'inspections', // sanitizeDefectStates + getReportData via InspectionService
    'plan-quota-guarded-services.spec.ts': 'usage', // PlanQuotaGuard applied at concierge/booking/inspection-request boundaries
    'plan-quota-notice.spec.ts': 'usage', // noticeFor() threshold-detection helper (Task 8)
    'plan-quota.spec.ts': 'usage', // PlanQuotaGuard core (tenants.tier + MeteringService)
    'quota-threshold-notice.spec.ts': 'usage', // EmailBaseService.sendQuotaThresholdNotice (Task 8)
    'team-remove-softdelete.spec.ts': 'tenancy', // TeamService.removeMember soft-delete, matches team-invite.service.spec.ts bucket
};
const RULES = [
    [/^usage|^metering|^r2-usage|^email-metering|^sms-metering/, 'usage'],
    [/^admin/, 'admin'],
    [/^agent/, 'agents'],
    [/^agreement|^auto-sign-publish|^inspector-pre-sign|^inspector-signature|^save-default-signature|^sign-completion-render|^inspection-sign-unification|^inspection-agreement-request/, 'agreements'],
    [/^ai\./, 'ai'],
    [/^analytics/, 'analytics'],
    [/^auth|^totp|^jwt-keyring|^m2m-auth|^token-hash|^iter2-bug4-logout-cookie|^sso-return-to/, 'auth'],
    [/^automation/, 'automations'],
    [/^billing|^stripe|^payment-method|^discount-redeem|^seat-|^checkout-public/, 'billing'],
    [/^booking|^availability|^schedule-conflicts|^track-g-schema/, 'bookings'],
    [/^branding|^brand-asset-guard/, 'branding'],
    [/^calendar|^ics-/, 'calendar'],
    [/^collab|^session-context-collab|^inspection-presence-do/, 'collab'],
    [/^comment|^quick-comments-scope|^recommendation|^aggregate-recommendations|^contractor-type|^library-replace|^editor-search/, 'comments'],
    [/^concierge/, 'concierge'],
    [/^contact|^referral-sources/, 'contacts'],
    [/^compliance|^messaging|^telnyx|^twilio|^sms-|^message|^resolve-twilio/, 'messaging'],
    [/^email|^resolve-email-provider|^sender-identity/, 'email'],
    [/^evidence/, 'evidence'],
    [/^erasure|^account-export-delete|^data-export|^tenant-purge|^retention-sweep|^orphan-gc/, 'privacy'],
    [/^integration-|^qbo|^starter-content/, 'integrations'],
    [/^invoice|^iter2-bug10-public-invoice/, 'invoices'],
    [/^marketplace/, 'marketplace'],
    [/^mcp/, 'mcp'],
    [/^media|^poster-timestamp|^session-context-video|^strip-exif/, 'media'],
    [/^notification/, 'notifications'],
    [/^pca|^report|^public-report|^render-token|^section-disclaimer-render|^version-diff|^observer-|^public-urls/, 'reports'],
    [/^portal|^owner-preview-access|^client-document|^client-message|^legal-links/, 'client-portal'],
    [/^repair/, 'repair'],
    [/^reinspection|^inspection|^clone-last|^cross-section-advance|^move-item-photo|^photo-crop-item|^cover-crop|^publish-readiness|^status-split|^can-edit|^defect-fields|^patch-defect-fields|^sanitize-defect-states|^finding-key|^verify-data|^collect-attached|^spectora|^unit-schema|^unit-service|^building-profile|^property-|^commercial-subtypes|^map-rating-levels/, 'inspections'],
    [/^sync-|^cmd-envelope/, 'sync'],
    [/^template|^seed-templates|^rating-system/, 'templates'],
    [/^tenant|^users-|^user-service-slug|^identity-service|^resolve-tenant-slug|^api-slug|^inspector-palette-tenant-slug/, 'tenancy'],
    [/^secrets|^config-crypto/, 'secrets'],
    [/^r2-/, 'storage'],
    // horizontal infrastructure fallthrough:
    [/^middleware-order|^rbac-|^require-capability|^roles|^role-enum-drift|^capabilities|^openapi-types|^typed-client-shape|^route-metadata|^pagination|^content-disposition|^inline-ddl-schema-sync|^deployment-profile/, 'platform'],
];
// existing grab-bag dirs to dissolve (same mapping applies to their contents):
const DISSOLVE = ['api', 'automation-core'];
// automation-core files have no automation- prefix; force their bucket:
const DISSOLVE_DEFAULT = { 'automation-core': 'automations' };
const KEEP_DIRS = new Set(['helpers', 'stubs', 'collab', 'email', 'mcp', 'messaging']);
const UNIT_INFRA = new Set(['db.ts', 'mocks.ts', 'setup-client.ts']);

function mapUnit(base, fromDir) {
    if (EXPLICIT[base]) return EXPLICIT[base];
    for (const [re, dir] of RULES) if (re.test(base)) return dir;
    if (fromDir && DISSOLVE_DEFAULT[fromDir]) return DISSOLVE_DEFAULT[fromDir];
    return null;
}

// ---------------------------------------------------------------------------
// Depth-aware import rewrite: for a file moving `delta` levels deeper, every
// relative specifier gains `delta` leading `../` segments. Only rewrites
// specifiers inside import/export/vi.mock/importActual/import()/require().
const SPEC_RE = /((?:from|import\s*\(|require\s*\(|vi\.(?:mock|doMock|importActual|importMock)\s*\()\s*['"])(\.\.?\/[^'"]*)(['"])/g;
function rewrite(content, delta) {
    if (delta === 0) return content;
    return content.replace(SPEC_RE, (_, pre, spec, post) => {
        let segs = spec.split('/');
        if (segs[0] === '.') segs.shift(); // drop leading '.' of './x'
        if (delta > 0) {
            return pre + [...Array(delta).fill('..'), ...segs].join('/') + post;
        }
        // delta < 0: strip |delta| leading '..' segments (they must be present)
        let up = 0;
        while (segs[0] === '..') { segs.shift(); up++; }
        const kept = Math.max(0, up + delta); // delta is negative
        const rebuilt = [...Array(kept).fill('..'), ...segs].join('/');
        return pre + (rebuilt.startsWith('..') ? rebuilt : './' + rebuilt) + post;
    });
}

const moves = []; // {from, to, delta, noRewrite}
function planMove(from, to, noRewrite = false) {
    const depth = (p) => p.split('/').length - 1;
    // Depth-delta rewriting is only valid for moves that stay on the same path
    // and go DEEPER (unit/integration buckets). Cross-subtree moves (co-locating
    // a web spec from tests/web/** into app/**) get noRewrite: their relative
    // specifiers can't be fixed by counting `../`. Component tests import via the
    // `~` alias (depth-independent) so this is almost always a no-op anyway; the
    // rare relative import is fixed by hand when the suite run flags it (Task 4).
    moves.push({ from, to, delta: noRewrite ? 0 : depth(to) - depth(from), noRewrite });
}

// --- scope: unit -----------------------------------------------------------
if (SCOPE === 'all' || SCOPE === 'unit') {
    const unmapped = [];
    for (const f of readdirSync(join(root, 'tests/unit'))) {
        if (!f.endsWith('.spec.ts') || UNIT_INFRA.has(f)) continue;
        const dir = mapUnit(f, null);
        if (!dir) { unmapped.push(f); continue; }
        planMove(`tests/unit/${f}`, `tests/unit/${dir}/${f}`);
    }
    for (const d of DISSOLVE) {
        for (const f of readdirSync(join(root, 'tests/unit', d))) {
            const dir = mapUnit(f, d);
            if (!dir) { unmapped.push(`${d}/${f}`); continue; }
            if (dir !== d) planMove(`tests/unit/${d}/${f}`, `tests/unit/${dir}/${f}`);
        }
    }
    planMove('tests/portal-isolation.spec.ts', 'tests/unit/sync/portal-isolation.spec.ts');
    if (unmapped.length) {
        console.error(`UNMAPPED unit specs (add to EXPLICIT/RULES):\n  ${unmapped.join('\n  ')}`);
        process.exit(1);
    }
}
// --- scope: e2e (merge ALL Playwright specs into one tests/e2e, R8) ----------
// tests/e2e/ already exists (subsystem-* orphans) — its contents stay put.
// Root-level specs and the former browser-smoke suite fold into it.
if (SCOPE === 'all' || SCOPE === 'e2e') {
    for (const f of readdirSync(join(root, 'tests'))) {
        if (!f.endsWith('.spec.ts') || f === 'portal-isolation.spec.ts') continue;
        planMove(`tests/${f}`, `tests/e2e/${f}`); // tests/ (depth 1) → tests/e2e/ (depth 2): delta +1
    }
    // former stateless browser smoke → tests/e2e (now runs against seeded D1).
    // noRewrite: this is a CROSS-SUBTREE move (tests/web/e2e → tests/e2e diverge
    // at tests/), so delta-counting `../` is invalid (a `../helpers` would need
    // `../web/helpers`). Today's 4 files have zero matching relative imports (all
    // `~/`-alias/package imports, untouched by rewrite); hand-fix any future
    // relative import the suite run flags.
    for (const f of readdirSync(join(root, 'tests/web/e2e'))) {
        if (f.endsWith('.ts')) planMove(`tests/web/e2e/${f}`, `tests/e2e/${f}`, /* noRewrite */ true);
    }
}
// --- scope: web (co-location, R2) --------------------------------------------
// Each frontend spec moves NEXT TO the component/module it tests. We locate the
// target by reading the spec's first `~/...` import (the `~` alias = ./app) and
// placing the test in that module's directory as `<Name>.test.tsx`. Specs whose
// first ~/ import can't be resolved to an app/ dir are reported for manual
// placement (no silent leftovers). Renames .spec.->.test. to match the
// co-located component-test convention (vitest include already accepts both).
const TILDE_IMPORT = /(?:from|import\s*\(|vi\.mock\s*\()\s*['"]~\/([^'"]+)['"]/;
// Specs with no first `~/` import (relative imports, or a target outside app/)
// — reviewed by hand in the Task 4 dry-run and pinned to their real home.
// Value is an `app/`-relative directory; the base filename is unchanged
// (.spec.->.test. rename still applied below).
const EXPLICIT_WEB = {
    // reads app/routes/settings-automations.tsx source text directly (no import)
    'automation-editor-logic-only.spec.ts': 'app/routes',
    'comment-typeahead.spec.ts': 'app/lib',
    'CommentLibraryList.spec.tsx': 'app/components/editor',
    'CommentTypeahead.spec.tsx': 'app/components/editor',
    // tests packages/shared-ui/src/FileDropzone — no app/ home; genuinely-shared bucket
    'file-dropzone.spec.ts': 'app/lib/__tests__',
    'ItemCommentsPanel.spec.tsx': 'app/components/template',
    'login-saas-bounce.spec.ts': 'app/routes',
    // exercises both InspectionStatusCards + InspectionHub, same directory
    'portal-hub.spec.ts': 'app/components/portal',
    'report-card-stack.summary.spec.ts': 'app/routes/public',
    // primary subject is app/routes/public/report-card-stack print-class constants
    'report-print-layout.spec.ts': 'app/routes/public',
    'settings-workspace-flags.spec.ts': 'app/lib/forms',
    'speedmode-coach.spec.ts': 'app/lib',
    'useCommentTypeahead.spec.ts': 'app/hooks',
    'xlsx-import.spec.ts': 'app/lib',
    'agreement-section.spec.ts': 'app/components/portal/sections',
    'messages.spec.ts': 'app/components/portal/sections',
    'payment-section.spec.ts': 'app/components/portal/sections',
    'progress-view.spec.ts': 'app/components/portal/sections',
    'repair-builder-section.spec.ts': 'app/components/portal/sections',
    'report-view.spec.ts': 'app/components/portal/sections',
};
function colocateTarget(specPath) {
    const base0 = specPath.split('/').pop();
    if (EXPLICIT_WEB[base0]) {
        const base = base0.replace(/\.spec\.(tsx?)$/, '.test.$1');
        return `${EXPLICIT_WEB[base0]}/${base}`;
    }
    const content = readFileSync(join(root, specPath), 'utf8');
    const m = content.match(TILDE_IMPORT);
    if (!m) return null;
    // '~/routes/inspections' -> app/routes ; '~/components/x/Foo' -> app/components/x
    const rel = m[1];
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const targetDir = join('app', dir).replace(/\\/g, '/');
    if (!existsSync(join(root, targetDir))) return null;
    const base = specPath.split('/').pop().replace(/\.spec\.(tsx?)$/, '.test.$1');
    return `${targetDir}/${base}`;
}
if (SCOPE === 'all' || SCOPE === 'web') {
    const unresolved = [];
    const isSpec = (f) => /\.(spec|test)\.tsx?$/.test(f);
    const webFiles = [
        ...readdirSync(join(root, 'tests/web')).filter(isSpec).map((f) => `tests/web/${f}`),
        ...readdirSync(join(root, 'tests/web/unit')).filter(isSpec).map((f) => `tests/web/unit/${f}`),
        ...readdirSync(join(root, 'tests/web/unit/portal-sections')).filter(isSpec).map((f) => `tests/web/unit/portal-sections/${f}`),
    ];
    for (const from of webFiles) {
        const to = colocateTarget(from);
        if (!to) { unresolved.push(from); continue; }
        planMove(from, to, /* noRewrite */ true);
    }
    if (unresolved.length) {
        console.error(`UNRESOLVED web specs (no first ~/ import → place by hand):\n  ${unresolved.join('\n  ')}`);
        // Do NOT exit — co-location is inherently partial; report and let the
        // human place the remainder. The APPLY run skips these (they stay put
        // and the layout gate later flags any left in tests/web/unit/ root).
    }
}

// --- execute / report ------------------------------------------------------
let rewrites = 0;
for (const m of moves) {
    const src = join(root, m.from);
    if (!existsSync(src)) { console.error(`missing: ${m.from}`); process.exit(1); }
    const content = readFileSync(src, 'utf8');
    const out = rewrite(content, m.delta);
    if (out !== content) rewrites++;
    console.log(`${APPLY ? 'MV' : 'plan'} ${m.from} -> ${m.to} (delta ${m.delta}${out !== content ? ', imports rewritten' : ''})`);
    if (APPLY) {
        // `git mv` on Windows (git 2.51.0.windows.1, at least) does NOT create
        // the destination directory itself — unlike plain `mv`, it fails with
        // "No such file or directory" when the target dir is new. Dry-run never
        // exercises this path (it doesn't call git mv), so pre-create it here.
        mkdirSync(join(root, dirname(m.to)), { recursive: true });
        execSync(`git mv "${posix.join(...m.from.split('/'))}" "${posix.join(...m.to.split('/'))}"`, { cwd: root });
        writeFileSync(join(root, m.to), out);
    }
}
console.log(`\n${moves.length} moves, ${rewrites} files with import rewrites, scope=${SCOPE}, ${APPLY ? 'APPLIED' : 'dry-run'}`);
