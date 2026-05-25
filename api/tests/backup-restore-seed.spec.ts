import { test, expect } from '@playwright/test';

// Use BASE_URL from environment or default to localhost
const BASE = process.env.BASE_URL || 'http://localhost:8789';

test.describe('Seeding Data for Backup Validation', () => {
    test('Initialize Workspace and Seed Data', async ({ request, page }) => {
        console.log(`Targeting: ${BASE}`);

        // 1. Setup Workspace (POST /setup)
        const setupRes = await request.post(`${BASE}/setup`, {
            data: {
                companyName: 'Backup Restore Test Corp',
                subdomain: 'br-test',
                email: 'admin@example.com',
                password: 'Testpassword!123',
            },
            headers: { 'Content-Type': 'application/json' },
        });
        if (![200, 409].includes(setupRes.status())) {
            console.error(`Setup failed with status ${setupRes.status()}:`, await setupRes.text());
        }
        expect([200, 409]).toContain(setupRes.status());

        // 2. Login
        await page.goto(`${BASE}/login`);
        await page.fill('input[name="email"]', 'admin@example.com');
        await page.fill('input[name="password"]', 'Testpassword!123');
        await page.click('button[type="submit"]');
        await expect(page).toHaveURL(/.*dashboard/);

        // Get token from cookie
        const cookies = await page.context().cookies();
        const token = cookies.find(c => c.name === 'inspector_token')?.value;
        expect(token).toBeDefined();

        const authHeader = { Authorization: `Bearer ${token}` };

        // 3. Create Template
        const templateRes = await request.post(`${BASE}/api/inspections/templates`, {
            data: {
                name: 'Backup Validation Template',
                schema: {
                    sections: [{
                        id: 's1',
                        title: 'Test Section',
                        items: [{ id: 'i1', title: 'Test Item', type: 'condition' }]
                    }]
                }
            },
            headers: authHeader
        });
        expect(templateRes.status()).toBe(201);
        const templateBody = await templateRes.json();
        const templateId = templateBody.template.id;

        // 4. Create Team User (Invite)
        const inviteRes = await request.post(`${BASE}/api/admin/invite`, {
            data: { email: 'team.member@example.com', role: 'agent' },
            headers: authHeader
        });
        expect(inviteRes.status()).toBe(201);

        // 5. Create Inspection Plan
        const inspectionRes = await request.post(`${BASE}/api/inspections`, {
            data: {
                propertyAddress: '123 Backup Lane',
                templateId: templateId
            },
            headers: authHeader
        });
        expect(inspectionRes.status()).toBe(201);

        console.log('✓ Seeding complete.');
    });
});
