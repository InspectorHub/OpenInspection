import { defineConfig } from '@playwright/test';

/**
 * Playwright config for real sandbox integration tests.
 * Run with: npm run test:integration
 *
 * - No globalSetup: the spec itself resets the DB in beforeAll.
 * - 30s timeout: real API calls can be slow.
 * - Only matches *.integration.spec.ts files.
 */
export default defineConfig({
    testMatch: '**/*.integration.spec.ts',
    timeout: 30_000,
    use: { headless: true },
    // Run serially to avoid DB state conflicts between suites
    workers: 1,
});
