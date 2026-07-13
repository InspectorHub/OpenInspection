import { defineConfig } from '@playwright/test';

export default defineConfig({
    globalSetup: './tests/global-setup.ts',
    testDir: './tests/e2e',
    testIgnore: ['**/*.integration.spec.ts'],
    timeout: 30000,
    // Every project shares ONE wrangler-dev worker + ONE local D1 (globalSetup
    // seeds it once). Cross-project parallelism therefore races on shared state:
    // multiple SETUP tests init the same admin (409s), and concurrent
    // `wrangler d1 execute --local` calls lock the SQLite file. Serialize.
    workers: 1,
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
        command: 'npm run build && npx wrangler dev -c build/server/wrangler.json --persist-to .wrangler/state --port 8789 --var E2E_EMAIL_SINK:1 --var SETUP_CODE:000000 --var DISABLE_RATE_LIMIT:1',
        url: 'http://127.0.0.1:8789/status',
        reuseExistingServer: true,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 60000,
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
        },
        {
            name: 'inspection-hub',
            testMatch: 'inspection-hub.spec.ts',
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
            // No dependency — the SETUP test in this spec is idempotent and
            // will create test data if not already present.
        },
        {
            // Sprint 1 C-9 — public-page responsive smoke (5 viewports × 3
            // pages). No D1 seed needed since all targets are public; runs
            // independent of api/browser/mobile projects.
            name: 'responsive',
            testMatch: 'public-pages-responsive.spec.ts',
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
        {
            // Sprint 2 regression — Track A fixes (A1-A4).
            name: 'sprint2-regression',
            testMatch: 'sprint2-regression.spec.ts',
        },
        {
            // R7-06 — public booking page native date input.
            name: 'booking-date-input',
            testMatch: 'booking-date-input.spec.ts',
        },
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
        { name: 'branding', testMatch: 'branding.spec.ts' },
        { name: 'repair-list', testMatch: 'repair-list.spec.ts' },
        { name: 'report-viewer', testMatch: 'report-viewer.spec.ts' },
        { name: 'inspection-edit-hotkeys', testMatch: 'inspection-edit-hotkeys.spec.ts', dependencies: ['editor-seed'] },
        // Phase 3 Task 16 — batch photo upload (library input multi-select).
        { name: 'batch-photo-upload', testMatch: 'batch-photo-upload.spec.ts', dependencies: ['editor-seed'] },
        { name: 'inspection-lifecycle', testMatch: 'inspection-lifecycle.spec.ts', dependencies: ['editor-seed'] },
        // Destructive (reset/restore DB) — env-gated inside the specs:
        { name: 'backup-restore-seed', testMatch: 'backup-restore-seed.spec.ts' },
        { name: 'backup-restore-verify', testMatch: 'backup-restore-verify.spec.ts' },
        // DS-0520 subsystem C/D/E — skip-shells pending multi-user seed harness:
        { name: 'subsystem-c-stripe-smoke', testMatch: 'subsystem-c-stripe-cross-repo-smoke.spec.ts' },
        { name: 'subsystem-d-flows', testMatch: 'subsystem-d-flows.spec.ts' },
        { name: 'subsystem-e-flows', testMatch: 'subsystem-e-flows.spec.ts' },
        // Commercial PCA Task 19a — real TOC page numbers (two-pass Chrome +
        // pdf-lib). Exercises the actual worker report render + BROWSER binding;
        // see tests/e2e/report-toc-numbers.spec.ts for its harness requirements.
        { name: 'report-toc-numbers', testMatch: 'report-toc-numbers.spec.ts', dependencies: ['editor-seed'] },
    ],
});
