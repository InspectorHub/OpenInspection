import { test, expect } from '@playwright/test';
import { generatePortalSignature } from './helpers/integration-sig';
import { loadDevVars } from './helpers/dev-vars';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_DIR = resolve(__dirname, '..');
const BASE_URL = 'http://localhost:8789';

const env = loadDevVars(APP_DIR);
const PORTAL_M2M_SECRET = env.PORTAL_M2M_SECRET || 'test-secret';

test.describe('Core Integration API', () => {
    test('PATCH /api/integration/tenants/:subdomain syncs tenant and admin user', async ({ request }) => {
        const subdomain = `sync-test-${Date.now()}`;
        const adminEmail = `admin@${subdomain}.test`;
        const adminPasswordHash = 'fake-hash-123';
        
        const payload = {
            subdomain,
            status: 'active',
            tier: 'pro',
            name: 'Sync Test Corp',
            deploymentMode: 'shared',
            adminEmail,
            adminPasswordHash
        };
        
        const body = JSON.stringify(payload);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = await generatePortalSignature(PORTAL_M2M_SECRET, timestamp, body);

        const res = await request.patch(`${BASE_URL}/api/integration/tenants/${subdomain}`, {
            headers: {
                'x-portal-signature': `${timestamp}.${signature}`,
                'Content-Type': 'application/json',
            },
            data: body,
        });

        if (!res.ok()) {
            console.error('Sync failed:', res.status(), await res.text());
        }
        expect(res.ok()).toBe(true);

        // Verify tenant exists in Core via login attempt (which checks D1)
        const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email: adminEmail, password: 'WrongPassword' }, // We don't know the plain password, but if it says "Incorrect password" instead of "User not found", it worked
        });
        
        const loginText = await loginRes.text();
        // If it's 401 Unauthorized, it means the user was found but password was wrong.
        // If it's 404 or something else, it might mean user wasn't created.
        expect(loginRes.status()).toBe(401);
        expect(loginText).toContain('Invalid credentials');
    });

    test('PATCH /api/integration/tenants/:subdomain rejects invalid signature', async ({ request }) => {
        const subdomain = 'invalid-sig-test';
        const payload = { subdomain, status: 'active' };
        const body = JSON.stringify(payload);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        
        const res = await request.patch(`${BASE_URL}/api/integration/tenants/${subdomain}`, {
            headers: {
                'x-portal-signature': `${timestamp}.invalidhash`,
                'Content-Type': 'application/json',
            },
            data: body,
        });

        expect(res.status()).toBe(401);
        const data = await res.json();
        expect(data.error).toBe('Invalid signature');
    });

    test('PATCH /api/integration/tenants/:subdomain rejects expired signature', async ({ request }) => {
        const subdomain = 'expired-sig-test';
        const payload = { subdomain, status: 'active' };
        const body = JSON.stringify(payload);
        // 10 minutes ago
        const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
        const signature = await generatePortalSignature(PORTAL_M2M_SECRET, timestamp, body);
        
        const res = await request.patch(`${BASE_URL}/api/integration/tenants/${subdomain}`, {
            headers: {
                'x-portal-signature': `${timestamp}.${signature}`,
                'Content-Type': 'application/json',
            },
            data: body,
        });

        expect(res.status()).toBe(401);
        const data = await res.json();
        expect(data.error).toBe('Signature expired');
    });
});
