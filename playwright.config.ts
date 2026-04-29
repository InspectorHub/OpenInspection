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
            name: 'cloud',
            testMatch: 'cloud-e2e.spec.ts',
            use: {
                baseURL: process.env.CLOUD_BASE_URL || 'https://openinspection-standalone.important-new.workers.dev',
            },
        },
    ],
});
