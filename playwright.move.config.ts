import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the dual-instance data-package move E2E.
 *
 * Two independent local engine instances are started, each with its own D1 and
 * R2 state, so a package can be exported from one and restored into the other:
 *   - source on 127.0.0.1:8787, persisting to .wrangler/move-source
 *   - target on 127.0.0.1:8789, persisting to .wrangler/move-target
 *
 * This config does NOT use the shared globalSetup (which clears the single dev
 * D1): each instance owns its state and the spec seeds its own owner through
 * /api/auth/setup. It is env-gated so it never joins the default `npm run
 * test:e2e` run — that suite shares one worker and one D1 and cannot host a
 * second instance. Run it explicitly:
 *
 *   MOVE_E2E=1 npx playwright test -c playwright.move.config.ts
 *
 * The spec collects only when MOVE_E2E is set; otherwise a .never.ts sentinel
 * keeps the project from reporting green over zero tests. The e2e-coverage gate
 * reads the MOVE_E2E switch from this file and still counts the spec as owned.
 */
const enabled = Boolean(process.env.MOVE_E2E);
const devArgs = (port: number, persist: string, appBaseUrl: string) =>
    `npx wrangler dev -c build/server/wrangler.json --persist-to ${persist} --port ${port} ` +
    `--var SETUP_CODE:000000 --var DISABLE_RATE_LIMIT:1 --var APP_BASE_URL:${appBaseUrl}`;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 300_000,
    expect: { timeout: 20_000 },
    workers: 1,
    fullyParallel: false,
    retries: 0,
    reporter: 'list',
    use: { headless: true, baseURL: 'http://127.0.0.1:8789' },
    tsconfig: './tsconfig.playwright.json',
    webServer: enabled ? [
        {
            command: devArgs(8787, '.wrangler/move-source', 'http://127.0.0.1:8787'),
            url: 'http://127.0.0.1:8787/status',
            reuseExistingServer: false,
            stdout: 'pipe', stderr: 'pipe', timeout: 300_000,
        },
        {
            command: devArgs(8789, '.wrangler/move-target', 'http://127.0.0.1:8789'),
            url: 'http://127.0.0.1:8789/status',
            reuseExistingServer: false,
            stdout: 'pipe', stderr: 'pipe', timeout: 300_000,
        },
    ] : [],
    projects: [
        {
            name: 'move',
            testMatch: enabled ? 'data-package-move.spec.ts' : 'data-package-move.never.ts',
        },
    ],
});
