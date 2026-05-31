import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web/e2e',
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'http://localhost:8787',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8787',
    timeout: 30000,
    reuseExistingServer: !process.env.CI,
  },
});
