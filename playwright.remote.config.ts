import { defineConfig } from '@playwright/test';

/**
 * Playwright config for running the merged tests/e2e suite against an
 * already-deployed Cloudflare Workers instance (no webServer, no
 * globalSetup/seed — remote target owns its own data).
 *
 * Folds in the former playwright.api.remote.config.ts's intent (a
 * testDir-wide remote runner over the API/browser/mobile specs, driven by
 * BASE_URL) alongside the former playwright.remote.config.ts's scope (the
 * web/e2e browser specs, driven by FRONTEND_URL). Integration-serial specs
 * stay on their own dedicated config/lane (playwright.integration.config.ts).
 *
 * Run: FRONTEND_URL=https://your-deploy.workers.dev npx playwright test -c playwright.remote.config.ts
 *   or: BASE_URL=https://your-deploy.workers.dev npx playwright test -c playwright.remote.config.ts
 */
export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: ['**/*.integration.spec.ts'],
    timeout: 60000,
    use: {
        headless: true,
        baseURL: process.env.FRONTEND_URL || process.env.BASE_URL || 'https://openinspection.important-new.workers.dev',
    },
});
