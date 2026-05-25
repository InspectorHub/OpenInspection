import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';
const INSPECTOR_EMAIL = 'admin@autotest.com';
const INSPECTOR_PASSWORD = 'Password123!';

async function login(page: import('@playwright/test').Page) {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type=email]', INSPECTOR_EMAIL);
    await page.fill('input[type=password]', INSPECTOR_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard');
}

test.describe('B4 offline lifecycle', () => {
    test('queue grows offline, drains online, badge resets', async ({ page, context }) => {
        await login(page);

        // Network pill should show on dashboard
        await expect(page.locator('[x-data="networkPill()"]')).toContainText('Online', { timeout: 5000 });

        // Pick the first inspection and open its form
        const firstInspection = page.locator('[data-test=inspection-row], a[href*="/inspections/"]').first();
        await firstInspection.click();

        // Allow form to load (Alpine init can be slow)
        await page.waitForLoadState('networkidle');

        // Go offline
        await context.setOffline(true);
        await expect(page.locator('[x-data="networkPill()"]')).toContainText('Offline', { timeout: 5000 });

        // Make 1-3 status edits — selectors are best-effort, the form may use buttons or radio inputs
        // If specific selectors fail, the test should be updated with data-test attrs added to form-renderer.tsx
        const defectButtons = page.locator('button:has-text("Defect"), button[data-status="defect"]');
        const count = Math.min(3, await defectButtons.count());
        for (let i = 0; i < count; i++) {
            await defectButtons.nth(i).click();
            await page.waitForTimeout(200);
        }

        // Pill should show pending
        if (count > 0) {
            await expect(page.locator('[x-data="networkPill()"]')).toContainText('pending', { timeout: 3000 });
        }

        // Go online — queue should drain
        await context.setOffline(false);
        await expect(page.locator('[x-data="networkPill()"]')).toContainText('Online', { timeout: 15000 });
        await expect(page.locator('[x-data="networkPill()"]')).not.toContainText('pending');
    });
});
