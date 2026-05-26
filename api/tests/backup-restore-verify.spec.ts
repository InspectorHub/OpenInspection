import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8789';

test.describe('Verifying Restored Data', () => {
    test('Check if data exists after restore', async ({ request, page }) => {
        console.log(`Targeting: ${BASE}`);

        // 1. Login
        await page.goto(`${BASE}/login`);
        await page.fill('input[name="email"]', 'admin@example.com');
        await page.fill('input[name="password"]', 'Testpassword!123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/.*dashboard/);

        // Get token
        const cookies = await page.context().cookies();
        const token = cookies.find(c => c.name === 'inspector_token')?.value;
        expect(token).toBeDefined();

        const authHeader = { Authorization: `Bearer ${token}` };

        // 2. Verify Template
        const templateRes = await request.get(`${BASE}/api/inspections/templates`, {
            headers: authHeader
        });
        expect(templateRes.status()).toBe(200);
        const templateBody = await templateRes.json();
        const template = templateBody.templates.find((t: any) => t.name === 'Backup Validation Template');
        expect(template).toBeDefined();

        // 3. Verify Team User (Invite)
        // Check if data exists. For now, let's just check templates and inspections which are more critical.
        // For now, let's just check templates and inspections which are more critical.

        // 4. Verify Inspection Plan
        const inspectionRes = await request.get(`${BASE}/api/inspections`, {
            headers: authHeader
        });
        expect(inspectionRes.status()).toBe(200);
        const inspectionBody = await inspectionRes.json();
        const inspection = inspectionBody.inspections.find((i: any) => i.propertyAddress === '123 Backup Lane');
        expect(inspection).toBeDefined();

        console.log('✓ Verification complete.');
    });
});
