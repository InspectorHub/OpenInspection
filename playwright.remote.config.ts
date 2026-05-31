import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web/e2e',
  timeout: 60000,
  use: {
    headless: true,
    baseURL: process.env.FRONTEND_URL || 'https://openinspection.important-new.workers.dev',
  },
});
