import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8789';

test.describe('Core Integration API (Service Binding)', () => {
    test('PATCH /api/integration/tenants/:slug syncs tenant and admin user', async ({ request }) => {
        const slug = `sync-test-${Date.now()}`;
        const adminEmail = `admin@${slug}.test`;
        const adminPasswordHash = 'fake-hash-123';

        const payload = {
            slug,
            status: 'active',
            tier: 'pro',
            name: 'Sync Test Corp',
            deploymentMode: 'shared',
            adminEmail,
            adminPasswordHash
        };

        const res = await request.patch(`${BASE_URL}/api/integration/tenants/${slug}`, {
            headers: {
                'cf-worker': 'portal-api',
                'Content-Type': 'application/json',
            },
            data: JSON.stringify(payload),
        });

        if (!res.ok()) {
            console.error('Sync failed:', res.status(), await res.text());
        }
        expect(res.ok()).toBe(true);

        const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email: adminEmail, password: 'WrongPassword' },
        });

        expect(loginRes.status()).toBe(401);
        const loginText = await loginRes.text();
        expect(loginText).toContain('Invalid credentials');
    });

    test('PATCH /api/integration/tenants/:slug rejects requests without cf-worker header', async ({ request }) => {
        const slug = 'no-binding-test';
        const payload = { slug, status: 'active' };

        const res = await request.patch(`${BASE_URL}/api/integration/tenants/${slug}`, {
            headers: {
                'Content-Type': 'application/json',
            },
            data: JSON.stringify(payload),
        });

        expect(res.status()).toBe(403);
        const data = await res.json();
        expect(data.error.message).toBe('Forbidden');
    });
});
