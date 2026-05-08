import { defineConfig } from '@playwright/test';

export default defineConfig({
    globalSetup: './tests/global-setup.ts',
    testDir: './tests',
    testIgnore: ['**/*.integration.spec.ts', '**/unit/**', 'cloud-e2e.spec.ts'],
    timeout: 30000,
    use: {
        headless: true,
        baseURL: 'http://127.0.0.1:8789',
    },
    tsconfig: './tsconfig.playwright.json',
    webServer: {
        command: 'npx wrangler dev --port 8789',
        url: 'http://127.0.0.1:8789/status',
        reuseExistingServer: true,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 60000,
    },
    projects: [
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
            name: 'cloud',
            testMatch: 'cloud-e2e.spec.ts',
            use: {
                baseURL: process.env.CLOUD_BASE_URL || 'https://openinspection-standalone.important-new.workers.dev',
            },
        },
    ],
});
