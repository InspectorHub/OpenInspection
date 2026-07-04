import { defineConfig } from '@playwright/test';

export default defineConfig({
    globalSetup: './tests/global-setup.ts',
    testDir: './tests/e2e',
    testIgnore: ['**/*.integration.spec.ts'],
    timeout: 30000,
    use: {
        headless: true,
        baseURL: 'http://127.0.0.1:8789',
    },
    tsconfig: './tsconfig.playwright.json',
    webServer: {
        command: 'npm run build && npx wrangler dev -c build/server/wrangler.json --persist-to .wrangler/state --port 8789',
        url: 'http://127.0.0.1:8789/status',
        reuseExistingServer: true,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 60000,
    },
    projects: [
        // former browser smoke (playwright.config.ts, tests/web/e2e) — now
        // seeded against real D1 by globalSetup, no self-seed needed:
        {
            name: 'browser-collab',
            testMatch: /collab-(editing|offline)\.spec\.ts$/,
        },
        {
            name: 'frontend-browser',
            testMatch: 'frontend-browser.spec.ts',
        },
        {
            name: 'inspection-hub',
            testMatch: 'inspection-hub.spec.ts',
        },
        // ...all projects previously in playwright.api.config.ts, verbatim:
        {
            name: 'api',
            testMatch: 'standalone-api.spec.ts',
        },
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
        {
            name: 'subsystem-a-speed-mode',
            testMatch: 'subsystem-a-speed-mode.spec.ts',
        },
        {
            name: 'subsystem-a-photo-studio',
            testMatch: 'subsystem-a-photo-studio.spec.ts',
        },
        {
            name: 'subsystem-a-inspector-tools-dock',
            testMatch: 'subsystem-a-inspector-tools-dock.spec.ts',
        },
        // Design System 0520 subsystem B — auto-skipped when env vars unset.
        {
            name: 'subsystem-b-wizard',
            testMatch: 'subsystem-b-wizard.spec.ts',
        },
        {
            name: 'subsystem-b-team-strip',
            testMatch: 'subsystem-b-team-strip.spec.ts',
        },
        // --- wired during 2026-07 tests reorg (were collected by no project) ---
        { name: 'branding', testMatch: 'branding.spec.ts' },
        { name: 'repair-list', testMatch: 'repair-list.spec.ts' },
        { name: 'report-viewer', testMatch: 'report-viewer.spec.ts' },
        { name: 'inspection-edit-hotkeys', testMatch: 'inspection-edit-hotkeys.spec.ts' },
        { name: 'inspection-lifecycle', testMatch: 'inspection-lifecycle.spec.ts' },
        // Destructive (reset/restore DB) — env-gated inside the specs:
        { name: 'backup-restore-seed', testMatch: 'backup-restore-seed.spec.ts' },
        { name: 'backup-restore-verify', testMatch: 'backup-restore-verify.spec.ts' },
        // DS-0520 subsystem C/D/E — skip-shells pending multi-user seed harness:
        { name: 'subsystem-c-stripe-smoke', testMatch: 'subsystem-c-stripe-cross-repo-smoke.spec.ts' },
        { name: 'subsystem-d-flows', testMatch: 'subsystem-d-flows.spec.ts' },
        { name: 'subsystem-e-flows', testMatch: 'subsystem-e-flows.spec.ts' },
    ],
});
