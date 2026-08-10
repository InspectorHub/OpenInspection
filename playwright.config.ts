import { defineConfig } from '@playwright/test';

export default defineConfig({
    globalSetup: './tests/global-setup.ts',
    testDir: './tests/e2e',
    testIgnore: ['**/*.integration.spec.ts'],
    timeout: 30000,
    // Every project still shares ONE wrangler-dev worker + ONE local D1
    // (globalSetup seeds it once), so this cannot go wide. It no longer has to
    // be 1, though: the three reasons it was are gone.
    //
    //   1. Several specs raced POST /api/auth/setup with DIFFERENT company
    //      names, so whichever won named the tenant. They now all send the one
    //      COMPANY_NAME from helpers/tenant-identity and depend on `api`, so a
    //      late setup 409s harmlessly instead of renaming the workspace.
    //   2. Four specs shelled out to `wrangler d1 execute --local` mid-test to
    //      re-hash an admin password that already had that exact value, and
    //      those calls locked the SQLite file. They are deleted. The one
    //      remaining CLI user is calendar-connect, which genuinely needs D1 and
    //      cannot contend with itself.
    //   3. Ten projects were handed the SAME seeded inspection, which only ever
    //      worked because they ran one at a time. The first run at 3 workers
    //      duly failed: SpeedMode found nothing left to rate after a concurrent
    //      spec had rated it. helpers/editor-seed.ts now seeds one inspection
    //      per editing project. (This reason was missed when 1 and 2 were fixed
    //      — the list above was written from what made the CLI and setup race,
    //      not from an audit of what else the projects share.)
    //
    // Kept deliberately low rather than left to the CPU-count default: the
    // shared worker and single D1 are the real ceiling, and every spec in a
    // parallel slot is another client of them. Raise further only with evidence.
    workers: 3,
    // The browser projects drive real WebSocket + Durable Object collab flows
    // against one shared wrangler-dev worker; transient socket resets
    // (ECONNRESET on a concurrent login) and WS reconnect timing occasionally
    // flake a single spec. Retry on CI so one transient blip can't red the run —
    // a genuine failure still fails all attempts. Locally keep 0 for fast, honest
    // feedback.
    retries: process.env.CI ? 2 : 0,
    use: {
        headless: true,
        baseURL: 'http://127.0.0.1:8789',
    },
    tsconfig: './tsconfig.playwright.json',
    webServer: {
        // --var injects E2E-only bindings onto the Playwright worker WITHOUT
        // touching .dev.vars, so `npm run dev` is unaffected:
        //   E2E_EMAIL_SINK=1   — capture outbound email to KV (read back via
        //                        /api/__test__/last-email) so the reset-token
        //                        happy path is testable end to end.
        //   SETUP_CODE=000000  — matches the api project's setup fixture in BOTH
        //                        CI and local (local .dev.vars may differ).
        //   DISABLE_RATE_LIMIT=1 — the seeded suite drives many logins from one IP.
        //   APP_BASE_URL=…:8789 — the origin the SERVER stamps into emailed links.
        //                        CI's generated .dev.vars omits it entirely, so CI
        //                        passed; a real local .dev.vars sets 8787 for
        //                        `npm run dev`, and the agent-unified-link spec then
        //                        followed an emailed link to a port nothing served
        //                        (ERR_CONNECTION_REFUSED). Pin it to the port this
        //                        worker actually listens on.
        command: 'npm run build && npx wrangler dev -c build/server/wrangler.json --persist-to .wrangler/state --port 8789 --var E2E_EMAIL_SINK:1 --var SETUP_CODE:000000 --var DISABLE_RATE_LIMIT:1 --var APP_BASE_URL:http://127.0.0.1:8789',
        url: 'http://127.0.0.1:8789/status',
        reuseExistingServer: true,
        stdout: 'pipe',
        stderr: 'pipe',
        // The command above contains a FULL build, so this budget has to cover
        // one. 60s did not: `npm run build` is vendor:copy + gen-version +
        // `react-router build`, and typegen alone is ~64s. It survived because
        // the Linux CI runner happens to finish inside a minute; on Windows the
        // same build measures 2m02s warm, so `npm run test:e2e` could not reach
        // a single test locally — it timed out in webServer three runs running,
        // which reads exactly like a broken suite rather than a short timer.
        //
        // A timeout is an upper bound, not a wait: raising it costs CI nothing
        // and makes the command runnable on the machines people actually use.
        timeout: 300000,
    },
    projects: [
        // api runs FIRST: it is the single-tenant workspace initializer. Its
        // API-01 asserts POST /api/auth/setup returns a fresh 200, and it creates
        // the shared admin (admin@autotest.com / Password123!) that every later
        // project logs in as. globalSetup clears D1 once before all projects, so
        // `api` must precede any other project's setup or API-01 sees a 409.
        {
            name: 'api',
            testMatch: 'standalone-api.spec.ts',
        },
        // former browser smoke (playwright.config.ts, tests/web/e2e) — now
        // seeded against real D1 by globalSetup, no self-seed needed:
        {
            name: 'browser-collab',
            testMatch: /collab-(editing|offline)\.spec\.ts$/,
            // Logs in as the shared admin@autotest.com that the `api` project
            // seeds — depend on it so ordering is deterministic and the project
            // is runnable in isolation (otherwise login 401s: no workspace).
            dependencies: ['api'],
        },
        {
            name: 'frontend-browser',
            testMatch: 'frontend-browser.spec.ts',
            dependencies: ['api'],
        },
        {
            // Anonymous requests only — asserts the guard boundary between the
            // auth-layout branch and the public routes. No seeded workspace
            // needed, hence no dependency on `api`.
            name: 'route-auth-boundary',
            testMatch: 'route-auth-boundary.spec.ts',
        },
        {
            // Its beforeAll seeds the admin password and then logs in, so it
            // needs the workspace to exist. That was true before this line and
            // it worked anyway, because with workers:1 the projects run in
            // declaration order and `api` is declared first — an ordering that
            // held by accident, not by contract, and one that any reordering or
            // parallel run would break.
            name: 'inspector-portal',
            testMatch: 'inspector-portal.spec.ts',
            dependencies: ['api'],
        },
        {
            // IA-29 / IA-30 — publishing is decoupled from order completion.
            // Self-seeds its own inspection (mutates order state), so it depends
            // on `api` for the admin workspace, not the shared editor-seed.
            name: 'lifecycle-publish',
            testMatch: 'inspection-lifecycle-publish.spec.ts',
            dependencies: ['api'],
        },
        // ...all projects previously in playwright.api.config.ts, verbatim
        // (the `api` initializer project is declared first, above):
        {
            name: 'browser',
            testMatch: 'standalone-browser.spec.ts',
            dependencies: ['api'],
        },
        {
            name: 'mobile',
            testMatch: 'standalone-mobile.spec.ts',
            // The old comment here claimed the SETUP test was idempotent and
            // would create the workspace if absent. It is not: POST
            // /api/auth/setup returns 409 once any user has a tenant_id, so
            // this spec either lost the race and 409'd, or WON it and named the
            // tenant "Mobile Test Corp" — which broke every spec asserting the
            // automation-test-corp slug. It now sends the shared COMPANY_NAME,
            // so a 409 is harmless, and depends on `api` to guarantee the
            // workspace exists rather than hoping to build it.
            dependencies: ['api'],
        },
        {
            // Sprint 1 C-9 — public-page responsive smoke (5 viewports × 3
            // pages). No D1 seed needed since all targets are public; runs
            // independent of api/browser/mobile projects.
            name: 'responsive',
            testMatch: 'public-pages-responsive.spec.ts',
        },
        {
            // #269 — i18n activation. Pre-auth only (/login), so it needs no D1
            // seed and no dependency on another project: the whole point is
            // that the locale resolves from the request alone.
            name: 'locale-activation',
            testMatch: 'locale-activation.spec.ts',
        },
        {
            // Sprint 1 D-8 — report-gate end-to-end (auth + payment + agreement
            // gates). Depends on browser project to ensure user is created.
            name: 'gates',
            testMatch: 'report-gate.spec.ts',
            dependencies: ['api'],
        },
        {
            // Sprint 2 Track 2 (S2-2) — multi-inspection per request smoke.
            name: 'multi-inspection',
            testMatch: 'multi-inspection-request.spec.ts',
        },
        {
            // Sprint 2 Track 2 (S2-5) — inspection sub-routes router smoke.
            name: 'subroutes',
            testMatch: 'inspection-subroutes.spec.ts',
        },
        {
            // Sprint 2 S2-1 — rating systems CRUD.
            name: 'rating-system-crud',
            testMatch: 'rating-system-crud.spec.ts',
            dependencies: ['api'],
        },
        {
            // Sprint 2 S2-4 — repair estimate range toggle + sanitizer.
            name: 'estimate-range',
            testMatch: 'estimate-range.spec.ts',
            dependencies: ['api'],
        },
        // `sprint2-regression` and `booking-date-input` projects deleted
        // (2026-08 skip-debt clearance) together with their spec files. Every
        // test in both was inside a `describe.skip` scraping Alpine-era source
        // files the RR migration removed (src/templates/**, public/js/auth.js)
        // or driving the Alpine booking form. A project whose testMatch
        // resolves to nothing is a new way to report green over zero tests, so
        // the entries go with the files.
        {
            // env-guarded (R8 fix): matches nothing by default so the dead
            // 'cloud' project no longer silently swallows via testIgnore —
            // it now collects only when CLOUD_BASE_URL is explicitly set.
            name: 'cloud',
            testMatch: process.env.CLOUD_BASE_URL ? 'cloud-e2e.spec.ts' : 'cloud-e2e.never.ts',
            use: {
                baseURL: process.env.CLOUD_BASE_URL || 'https://openinspection-api.important-new.workers.dev',
            },
        },
        // Design System 0520 subsystem A E2E suites. Skipped automatically
        // when TEST_INSPECTOR_EMAIL / _PASSWORD / TEST_INSPECTION_ID are not
        // set, so local CI passes without seed data.
        // Seeds one editable inspection (with items) + writes the editor-seed
        // handoff the editor subsystem specs read. Depends on `api` so the
        // admin it logs in as already exists. Runs whenever any editor spec runs.
        {
            name: 'editor-seed',
            testMatch: 'editor-seed.setup.ts',
            dependencies: ['api'],
        },
        {
            name: 'subsystem-a-speed-mode',
            testMatch: 'subsystem-a-speed-mode.spec.ts',
            dependencies: ['editor-seed'],
        },
        {
            name: 'subsystem-a-photo-studio',
            testMatch: 'subsystem-a-photo-studio.spec.ts',
        },
        {
            name: 'subsystem-a-inspector-tools-dock',
            testMatch: 'subsystem-a-inspector-tools-dock.spec.ts',
            dependencies: ['editor-seed'],
        },
        // Design System 0520 subsystem B — auto-skipped when env vars unset.
        {
            name: 'subsystem-b-wizard',
            testMatch: 'subsystem-b-wizard.spec.ts',
            dependencies: ['editor-seed'],
        },
        {
            name: 'subsystem-b-team-strip',
            testMatch: 'subsystem-b-team-strip.spec.ts',
        },
        // --- wired during 2026-07 tests reorg (were collected by no project) ---
        // Standalone password-reset / auth-page unification (#223, #224). The
        // public-page tests (forgot / reset / login link) need no seed, but the
        // valid-token happy path invites a throwaway member off the shared admin,
        // so depend on `api` (which seeds admin@autotest.com). The reset token is
        // read back from the E2E email sink (E2E_EMAIL_SINK, wired on the worker).
        { name: 'auth-password-reset', testMatch: 'auth-password-reset.spec.ts', dependencies: ['api'] },
        // Both run the setup wizard. They used to send their own company names
        // ("Branding Corp", "Timezone Corp"), which meant whichever reached
        // /api/auth/setup first named the tenant for the whole run.
        { name: 'branding', testMatch: 'branding.spec.ts', dependencies: ['api'] },
        { name: 'timezone-settings', testMatch: 'timezone-settings.spec.ts', dependencies: ['api'] },
        // Calendar multiprovider (#199) — API-level capability gating; depends on
        // `api` so admin@autotest.com exists in the shared D1 seed.
        { name: 'calendar-connect', testMatch: 'calendar-connect.spec.ts', dependencies: ['api'] },
        // Scheduling Phase A-core — G1–G3 acceptance gates (holidays + schedule + slots).
        { name: 'scheduling-phase-a-core', testMatch: 'scheduling-phase-a-core.spec.ts', dependencies: ['api'] },
        // Scheduling Phase C — the dispatch board's drag-to-assign and the
        // block-policy refusal. Mutates the tenant's booking_conflict_policy, so
        // it must not share a worker slot with another spec that reads it.
        { name: 'dispatch-board', testMatch: 'dispatch-board.spec.ts', dependencies: ['api'] },
        { name: 'repair-list', testMatch: 'repair-list.spec.ts' },
        { name: 'report-viewer', testMatch: 'report-viewer.spec.ts' },
        { name: 'inspection-edit-hotkeys', testMatch: 'inspection-edit-hotkeys.spec.ts', dependencies: ['editor-seed'] },
        // Phase 3 Task 16 — batch photo upload (library input multi-select).
        { name: 'batch-photo-upload', testMatch: 'batch-photo-upload.spec.ts', dependencies: ['editor-seed'] },
        { name: 'inspection-lifecycle', testMatch: 'inspection-lifecycle.spec.ts', dependencies: ['editor-seed'] },
        // Destructive (reset/restore DB) — env-gated inside the specs:
        { name: 'backup-restore-seed', testMatch: 'backup-restore-seed.spec.ts' },
        { name: 'backup-restore-verify', testMatch: 'backup-restore-verify.spec.ts' },
        // DS-0520 subsystem C — still a skip-shell, and for a reason nothing in
        // this repo can supply: two servers plus the Stripe CLI. See the spec.
        { name: 'subsystem-c-stripe-smoke', testMatch: 'subsystem-c-stripe-cross-repo-smoke.spec.ts' },
        // subsystem-d-flows / subsystem-e-flows moved to playwright.seeded.config.ts.
        // They need the multi-user seed, which writes users into the standalone
        // tenant and therefore 409s the `api` project's fresh-setup assertion —
        // the two cannot share one D1. `npm run test:e2e:seeded` runs them.
        // Commercial PCA Task 19a — real TOC page numbers (two-pass Chrome +
        // pdf-lib). Exercises the actual worker report render + BROWSER binding;
        // see tests/e2e/report-toc-numbers.spec.ts for its harness requirements.
        { name: 'report-toc-numbers', testMatch: 'report-toc-numbers.spec.ts', dependencies: ['editor-seed'] },
        // Plan 1B Task 8 — people/role-profile flow (Roles tab CRUD + People
        // section add + primary-client conflict). Depends on `editor-seed` for
        // the shared admin + a real inspection id (the `api` project it in
        // turn depends on already seeds the 8 default role profiles).
        { name: 'people-role-profiles', testMatch: 'people-role-profiles.spec.ts', dependencies: ['editor-seed'] },
        // Workspace responsive smoke — the authenticated counterpart to
        // public-pages-responsive. Depends on editor-seed for a login.
        { name: 'workspace-pages-responsive', testMatch: 'workspace-pages-responsive.spec.ts', dependencies: ['editor-seed'] },
        // Issue #250 — settings-communication sticky section-nav (scroll-spy).
        { name: 'settings-communication-nav', testMatch: 'settings-communication-nav.spec.ts', dependencies: ['editor-seed'] },
        // Spec 2 Task 8 — role-aware report sending (final task of the
        // role-aware-sending plan). Seeds its own template + inspection (does
        // NOT reuse the shared editor-seed fixture — it flips that
        // inspection's global status via /complete + /publish). Depends on
        // `api` for the shared admin + the 8 seeded default role profiles.
        { name: 'role-aware-sending', testMatch: 'role-aware-sending.spec.ts', dependencies: ['api'] },
        // Spec 3 Task 8 — agent unified link (final task of the agent-unified-
        // link plan). Seeds its own two dedicated inspections (registered vs
        // unregistered agent recipient) and a global agent account — depends
        // on `api` for the shared admin + the 8 seeded default role profiles.
        { name: 'agent-unified-link', testMatch: 'agent-unified-link.spec.ts', dependencies: ['api'] },
        // #198/#200 — Google Places address autocomplete + property auto-fill.
        // Verifies real-browser wiring + graceful degradation (no external keys
        // locally). Uses the shared editor-seed admin + inspection.
        { name: 'address-autofill', testMatch: 'address-autofill.spec.ts', dependencies: ['editor-seed'] },
        {
            // #99 — what a public visitor pays for the 419-zone timezone table.
            // A MEASUREMENT HARNESS, not a gate: it prints a table and asserts
            // only that its own instrument works. Env-gated off by default for
            // two reasons that both matter. It costs several throttled page
            // loads for numbers nobody reads on a normal run; and a wall-clock
            // threshold on a shared runner is a coin flip, so wiring it into CI
            // would buy flake rather than signal. Same `.never.ts` shape as the
            // `cloud` project — a project matching nothing is otherwise a fresh
            // way to report green over zero tests.
            name: 'timezone-perf',
            testMatch: process.env.TZ_PERF
                ? 'public-timezone-hydration-cost.spec.ts'
                : 'public-timezone-hydration-cost.never.ts',
        },
    ],
});
