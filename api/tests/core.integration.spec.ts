/**
 * Integration tests against real sandbox credentials.
 *
 * These tests exercise the actual Stripe, Gemini, and Google Calendar APIs.
 * Each test is skipped automatically when the required credential is absent
 * in .dev.vars — so CI passes without any secrets configured.
 *
 * To run:
 *   1. Copy .dev.vars.example → .dev.vars and fill in sandbox credentials.
 *   2. Start the dev server: npm run dev
 *   3. Run: npm run test:integration
 *
 * NOTE: Tests use a fresh workspace bootstrapped in beforeAll. The DB is reset
 * using wrangler before the suite runs, just like the main globalSetup.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { loadDevVars } from './helpers/dev-vars';
import { makeStripeSignature } from './helpers/stripe-sig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_DIR = resolve(__dirname, '..');
const BASE_URL = 'http://localhost:8789';

const env = loadDevVars(APP_DIR);

// --- Bootstrap state (set in beforeAll) ---
let authToken = '';
let tenantId = '';
let userId = '';
let inspectionId = '';

interface SetupResponse { token: string; }
interface Inspection { id: string; paymentStatus?: string; [key: string]: any }
interface InspectionResponse { id?: string; inspection?: Inspection }
interface StripeResponse { checkoutUrl?: string; url?: string }
interface AIResponse { text?: string; summary?: string }
interface CalendarSyncResponse { success: boolean; totalEvents: number; blockedDatesCreated: number }

// Reset the local D1 database and bootstrap a fresh workspace
async function resetAndBootstrap(request: import('@playwright/test').APIRequestContext) {
    // 1. Clear all rows (FK-safe order)
    const sql = [
        'PRAGMA foreign_keys=OFF;',
        'DELETE FROM inspection_agreements;',
        'DELETE FROM inspection_results;',
        'DELETE FROM inspections;',
        'DELETE FROM availability_overrides;',
        'DELETE FROM availability;',
        'DELETE FROM tenant_invites;',
        'DELETE FROM agreements;',
        'DELETE FROM templates;',
        'DELETE FROM users;',
        'DELETE FROM tenants;',
        'PRAGMA foreign_keys=ON;',
    ].join('\n');
    const sqlFile = resolve(os.tmpdir(), 'reset-core-integration.sql');
    writeFileSync(sqlFile, sql, 'utf8');
    try {
        execSync(`npx wrangler d1 execute openinspection-db --local --file "${sqlFile}"`, {
            cwd: APP_DIR, stdio: 'pipe',
        });
    } finally {
        if (existsSync(sqlFile)) rmSync(sqlFile);
    }

    // 2. Run setup wizard (creates tenant + admin user)
    const setupRes = await request.post(`${BASE_URL}/setup`, {
        data: {
            companyName: 'Integration Test Co',
            subdomain: 'integration',
            email: 'admin@integration.test',
            password: 'TestPass123!',
        },
    });
    if (!setupRes.ok()) {
        throw new Error(`Setup failed: ${setupRes.status()} ${await setupRes.text()}`);
    }
    const setupData = await setupRes.json() as SetupResponse;
    authToken = setupData.token;
    const payloadB64 = authToken.split('.')[1]!;
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadStr);
    tenantId = payload['custom:tenantId'];
    userId = payload.sub;

    // 3. Create a test inspection
    const inspRes = await request.post(`${BASE_URL}/api/inspections`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {
            propertyAddress: '123 Integration St',
            clientName: 'Test Client',
            clientEmail: 'client@test.com',
            date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
    });
    if (inspRes.ok()) {
        const d = await inspRes.json() as InspectionResponse;
        inspectionId = d.id ?? d.inspection?.id ?? '';
    }
}

test.describe.serial('Integration: Bootstrap', () => {
    test.beforeAll(async ({ request }) => {
        await resetAndBootstrap(request);
    });

    test('workspace is initialised', () => {
        expect(authToken).toBeTruthy();
        expect(tenantId).toBeTruthy();
        expect(userId).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

test.describe.serial('Integration: Stripe Checkout (core)', () => {
    test.beforeAll(async ({ request }) => {
        if (!authToken) await resetAndBootstrap(request);
    });

    test('POST /api/inspections/:id/checkout returns real Stripe checkout URL', async ({ request }) => {
        const stripeKey = env.STRIPE_SECRET_KEY;
        test.skip(!stripeKey || stripeKey.includes('your_'), 'STRIPE_SECRET_KEY not configured');
        test.skip(!inspectionId, 'No inspection available');

        const res = await request.post(`${BASE_URL}/api/inspections/${inspectionId}/checkout`, {
            data: {
                successUrl: `${BASE_URL}/api/inspections/${inspectionId}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${BASE_URL}/book`,
            },
        });

        expect(res.ok()).toBe(true);
        const body = await res.json() as StripeResponse;
        // Real Stripe returns a checkout.stripe.com URL; mock returns localhost
        expect(body.checkoutUrl ?? body.url).toMatch(/stripe\.com/);
    });

    test('POST /api/inspections/webhook/stripe (payment_intent.succeeded) marks inspection paid', async ({ request }) => {
        const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
        test.skip(!webhookSecret || webhookSecret.includes('your_'), 'STRIPE_WEBHOOK_SECRET not configured');
        test.skip(!inspectionId, 'No inspection available');

        const payload = JSON.stringify({
            id: 'evt_test_integration',
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: 'pi_test_integration',
                    metadata: { inspectionId },
                    amount: 45000,
                    currency: 'usd',
                },
            },
        });
        const sig = makeStripeSignature(payload, webhookSecret);

        const res = await request.post(`${BASE_URL}/api/inspections/webhook/stripe`, {
            headers: {
                'Content-Type': 'application/json',
                'stripe-signature': sig,
            },
            data: payload,
        });

        expect(res.ok()).toBe(true);

        // Verify inspection is now marked paid
        const inspRes = await request.get(`${BASE_URL}/api/inspections/${inspectionId}`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (inspRes.ok()) {
            const insp = await inspRes.json() as Inspection;
            expect(insp.paymentStatus ?? insp.inspection?.paymentStatus).toBe('paid');
        }
    });
});

// ---------------------------------------------------------------------------
// Gemini AI
// ---------------------------------------------------------------------------

test.describe.serial('Integration: Gemini AI', () => {
    test.beforeAll(async ({ request }) => {
        if (!authToken) await resetAndBootstrap(request);
    });

    test('POST /api/ai/comment-assist returns professional rewrite', async ({ request }) => {
        const geminiKey = env.GEMINI_API_KEY;
        test.skip(!geminiKey || geminiKey.includes('your_'), 'GEMINI_API_KEY not configured');

        const res = await request.post(`${BASE_URL}/api/ai/comment-assist`, {
            headers: { Authorization: `Bearer ${authToken}` },
            data: { text: 'rust on panel', context: 'Electrical Panel' },
        });

        expect(res.ok()).toBe(true);
        const body = await res.json() as AIResponse;
        expect(typeof body.text).toBe('string');
        expect(body.text?.length).toBeGreaterThan(10);
        // Should be more formal than the raw note
        expect(body.text?.toLowerCase()).not.toBe('rust on panel');
    });

    test('POST /api/ai/auto-summary returns defect summary when results exist', async ({ request }) => {
        const geminiKey = env.GEMINI_API_KEY;
        test.skip(!geminiKey || geminiKey.includes('your_'), 'GEMINI_API_KEY not configured');
        test.skip(!inspectionId, 'No inspection available');

        // Seed some defect results first
        const seedRes = await request.patch(`${BASE_URL}/api/inspections/${inspectionId}/results`, {
            headers: { Authorization: `Bearer ${authToken}` },
            data: {
                'item-roof-1': { status: 'Defect', notes: 'Multiple missing shingles observed' },
                'item-elec-1': { status: 'Defect', notes: 'Rust and corrosion on main panel breakers' },
            },
        });
        // Accept 200 or 404 (results may already exist from a previous run)
        expect([200, 404].includes(seedRes.status())).toBe(true);

        const res = await request.post(`${BASE_URL}/api/ai/auto-summary`, {
            headers: { Authorization: `Bearer ${authToken}` },
            data: { inspectionId },
        });

        // If no results found the API returns 404 — that's valid too
        if (res.status() === 404) return;

        expect(res.ok()).toBe(true);
        const body = await res.json() as AIResponse;
        expect(typeof body.summary).toBe('string');
        expect(body.summary?.length).toBeGreaterThan(10);
    });
});

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

test.describe.serial('Integration: Google Calendar', () => {
    test.beforeAll(async ({ request }) => {
        if (!authToken) await resetAndBootstrap(request);
    });

    test('GET /api/calendar/connect redirects to Google OAuth when credentials configured', async ({ request }) => {
        const clientId = env.GOOGLE_CLIENT_ID;
        test.skip(!clientId || clientId.includes('your_'), 'GOOGLE_CLIENT_ID not configured');

        // Need a cookie-based session — get the cookie from login
        const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email: 'admin@integration.test', password: 'TestPass123!' },
        });
        expect(loginRes.ok()).toBe(true);

        // Follow connect with cookie (Playwright test API doesn't follow redirects by default)
        const connectRes = await request.get(`${BASE_URL}/api/calendar/connect`, {
            maxRedirects: 0,
        });

        // Expects a redirect to Google's OAuth server
        expect([301, 302].includes(connectRes.status())).toBe(true);
        const location = connectRes.headers()['location'] ?? '';
        expect(location).toContain('accounts.google.com');
        expect(location).toContain('calendar.events');
    });

    test('POST /api/calendar/sync with pre-obtained refresh token creates blocked dates', async ({ request }) => {
        const refreshToken = env.INTEGRATION_GOOGLE_REFRESH_TOKEN;
        const clientId = env.GOOGLE_CLIENT_ID;
        const clientSecret = env.GOOGLE_CLIENT_SECRET;
        test.skip(!refreshToken || !clientId || !clientSecret, 'Google Calendar sandbox credentials not configured — set INTEGRATION_GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .dev.vars');

        // Seed the google_refresh_token for the test user via wrangler SQL
        const seedSql = `UPDATE users SET google_refresh_token = '${refreshToken}', google_calendar_id = 'primary' WHERE id = '${userId}';`;
        const seedFile = resolve(os.tmpdir(), 'seed-google-token.sql');
        writeFileSync(seedFile, seedSql, 'utf8');
        try {
            execSync(`npx wrangler d1 execute openinspection-db --local --file "${seedFile}"`, {
                cwd: APP_DIR, stdio: 'pipe',
            });
        } finally {
            if (existsSync(seedFile)) rmSync(seedFile);
        }

        // Login to get cookie
        const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email: 'admin@integration.test', password: 'TestPass123!' },
        });
        expect(loginRes.ok()).toBe(true);

        // Run sync
        const syncRes = await request.post(`${BASE_URL}/api/calendar/sync`);

        expect(syncRes.ok()).toBe(true);
        const body = await syncRes.json() as CalendarSyncResponse;
        expect(body.success).toBe(true);
        expect(typeof body.totalEvents).toBe('number');
        expect(typeof body.blockedDatesCreated).toBe('number');
    });
});
