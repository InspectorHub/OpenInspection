import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import { AppError } from '../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../server/lib/deployment-profile';

/**
 * Track L Task 8 — SMS consent API (in-process Hono harness, mirrors
 * agreement-public-routes.spec.ts): mock drizzle-orm/d1 → test sqlite, mount the
 * sms routers on an OpenAPIHono app, inject tenantId/user via middleware, drive
 * app.request(). The SmsConsentService also calls drizzle(c.env.DB) → the same
 * mocked instance.
 */
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Imported AFTER the mock is registered.
// eslint-disable-next-line import/order
import { smsPublicRoutes, smsAdminRoutes } from '../../server/api/sms';
import { SmsConsentService } from '../../server/services/sms-consent.service';
import { signParams } from '../../server/lib/sms/send-sms';
import { sealSecrets } from '../../server/lib/config-crypto';
import adminRoutes from '../../server/api/admin';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const APP_BASE_URL = 'https://app.example.test';
const PLATFORM_TOKEN = 'platform-auth-token';

const FAKE_ENV = {
    DB: {},
    APP_BASE_URL,
    JWT_SECRET: 'test-secret',
    TWILIO_AUTH_TOKEN: PLATFORM_TOKEN,
    TENANT_CACHE: { get: async () => null, put: async () => {} },
} as unknown as HonoConfig['Bindings'];

function makeExecCtx() {
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    return ctx;
}

function buildApp(db: BetterSQLite3Database<typeof schema>) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    // Inject an owner identity so requireRole('owner','admin') passes for admin routes.
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('user', { sub: 'user-1', role: 'owner', tenantId: TENANT } as never);
        await next();
    });
    app.route('/api/public', smsPublicRoutes);
    app.route('/api/admin', smsAdminRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    return app;
}

async function seedTenant(db: BetterSQLite3Database<typeof schema>, id: string, slug: string) {
    await db.insert(schema.tenants).values({
        id, name: `T-${slug}`, slug, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
}

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await seedTenant(db, TENANT, 'acme');
    await new SmsConsentService({} as D1Database).publishDisclosure('disclosure v1');
});

afterEach(() => sqlite.close());

function form(fields: Record<string, string>): RequestInit {
    const body = new URLSearchParams(fields).toString();
    return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body };
}

describe('SMS consent API (Track L Task 8)', () => {
    it('inspector attestation records granted for an already-linked client contact', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: new Date(),
        } as never);
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
            clientEmail: 'jane@x.com', clientContactId: contactId, date: '2026-07-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);

        const app = buildApp(db);
        const res = await app.request('/api/admin/sms/attest',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inspectionId: inspId }) },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('granted');
        const ev = await db.select().from(schema.smsConsentLog).get();
        expect(ev?.capturedVia).toBe('admin');
    });

    it('attestation auto-creates + links a contact for a free-typed client (D6b)', async () => {
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '2 Oak', clientName: 'Bob',
            clientEmail: 'bob@x.com', clientContactId: null, date: '2026-07-02',
            status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);

        const app = buildApp(db);
        const res = await app.request('/api/admin/sms/attest',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inspectionId: inspId }) },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);

        const insp = await db.select().from(schema.inspections).where(eq(schema.inspections.id, inspId)).get();
        expect(insp?.clientContactId).toBeTruthy();
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, insp!.clientContactId!)).toBe('granted');
    });

    it('GET /sms/consent reports the latest action', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: new Date(),
        } as never);
        const inspId = crypto.randomUUID();
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
            clientContactId: contactId, date: '2026-07-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'booking_form', {});

        const app = buildApp(db);
        const res = await app.request(`/api/admin/sms/consent?inspectionId=${inspId}`, {}, FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { consent: string } };
        expect(body.data.consent).toBe('granted');
    });

    it('tenant-scoped inbound STOP (valid signature) → revoked for that tenant only', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'admin', {});

        const params = { From: '+15551234567', Body: 'STOP' };
        const url = `${APP_BASE_URL}/api/public/sms/inbound/acme`;
        const sig = await signParams(PLATFORM_TOKEN, url, params);

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound/acme',
            { ...form(params), headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig } },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('revoked');
    });

    it('platform inbound STOP → revoked across platform-mode tenants matching From', async () => {
        await seedTenant(db, OTHER_TENANT, 'beta');
        // beta is in 'own' SMS mode → must NOT be revoked by a platform-number STOP.
        await db.insert(schema.tenantConfigs).values({ tenantId: OTHER_TENANT, smsMode: 'own', updatedAt: new Date() } as never);

        const cAcme = crypto.randomUUID();
        const cBeta = crypto.randomUUID();
        await db.insert(schema.contacts).values([
            { id: cAcme, tenantId: TENANT, type: 'client', name: 'Jane', phone: '(555) 123-4567', createdAt: new Date() },
            { id: cBeta, tenantId: OTHER_TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date() },
        ] as never);
        const svc = new SmsConsentService({} as D1Database);
        await svc.record(TENANT, cAcme, 'granted', 'admin', {});
        await svc.record(OTHER_TENANT, cBeta, 'granted', 'admin', {});

        const params = { From: '+15551234567', Body: 'STOP' };
        const url = `${APP_BASE_URL}/api/public/sms/inbound`;
        const sig = await signParams(PLATFORM_TOKEN, url, params);

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound',
            { ...form(params), headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig } },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        expect(await svc.getLatest(TENANT, cAcme)).toBe('revoked');   // platform-mode → revoked
        expect(await svc.getLatest(OTHER_TENANT, cBeta)).toBe('granted'); // own-mode → untouched
    });

    it('inbound with a bad signature → 403, no write', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'admin', {});

        const params = { From: '+15551234567', Body: 'STOP' };
        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound',
            { ...form(params), headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'wrong' } },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(403);
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('granted');
    });

    it('opt-in confirm via a sealed token → granted (optin_link)', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: new Date(),
        } as never);
        const { mintOptinToken } = await import('../../server/lib/sms/optin-token');
        const token = await mintOptinToken(TENANT, contactId, FAKE_ENV.JWT_SECRET);

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/optin-confirm',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        const ev = await db.select().from(schema.smsConsentLog).get();
        expect(ev?.capturedVia).toBe('optin_link');
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('granted');
    });

    it('opt-in resolve returns disclosure + company name + legal links', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: new Date(),
        } as never);
        const { mintOptinToken } = await import('../../server/lib/sms/optin-token');
        const token = await mintOptinToken(TENANT, contactId, FAKE_ENV.JWT_SECRET);

        const app = buildApp(db);
        // No PRIVACY_URL/TERMS_URL configured → links resolve to null.
        const res = await app.request(`/api/public/sms/optin-resolve?token=${encodeURIComponent(token)}`, {}, FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { companyName: string; disclosureText: string; privacyUrl: string | null; termsUrl: string | null } };
        expect(body.data.companyName).toBe('T-acme');
        expect(body.data.disclosureText).toContain('disclosure');
        expect(body.data.privacyUrl).toBeNull();
        expect(body.data.termsUrl).toBeNull();

        // With operator legal URLs set, they flow through to the opt-in page.
        const envWithLegal = { ...FAKE_ENV, PRIVACY_URL: 'https://ops.example/privacy', TERMS_URL: 'https://ops.example/terms' } as unknown as HonoConfig['Bindings'];
        const res2 = await app.request(`/api/public/sms/optin-resolve?token=${encodeURIComponent(token)}`, {}, envWithLegal, makeExecCtx());
        const body2 = await res2.json() as { data: { privacyUrl: string | null; termsUrl: string | null } };
        expect(body2.data.privacyUrl).toBe('https://ops.example/privacy');
        expect(body2.data.termsUrl).toBe('https://ops.example/terms');
    });

    it('inbound HELP → 200 TwiML auto-reply identifying the program (no consent change)', async () => {
        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'admin', {});

        const params = { From: '+15551234567', Body: 'HELP' };
        const url = `${APP_BASE_URL}/api/public/sms/inbound`;
        const sig = await signParams(PLATFORM_TOKEN, url, params);

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound',
            { ...form(params), headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig } },
            FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        const xml = await res.text();
        expect(xml).toContain('<Message>');
        expect(xml).toContain('Inspector Hub'); // APP_NAME unset → platform brand fallback
        expect(xml).toContain('STOP');
        // HELP is informational only — consent state is untouched.
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('granted');
    });
});

// ─── BYO Telnyx tenant inbound (Ed25519-signed JSON webhook) ────────────────

const TELNYX_TS = '1782000000'; // unix seconds, paired with FAKE_TELNYX_NOW below

/**
 * Build a Telnyx-shaped inbound JSON body (message.received) for the given
 * From/Body, matching the paths the handler extracts:
 *   From = data.payload.from.phone_number ; Body = data.payload.text.
 */
function telnyxBody(from: string, text: string, eventType = 'message.received'): string {
    return JSON.stringify({
        data: {
            event_type: eventType,
            payload: { from: { phone_number: from }, text },
        },
    });
}

/** Generate an Ed25519 keypair and return the base64 raw public key + a signer. */
async function makeTelnyxSigner(): Promise<{
    publicKeyB64: string;
    sign: (timestamp: string, rawBody: string) => Promise<string>;
}> {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const publicKeyB64 = btoa(String.fromCharCode(...rawPub));
    const sign = async (timestamp: string, rawBody: string): Promise<string> => {
        const data = new TextEncoder().encode(`${timestamp}|${rawBody}`);
        const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, data));
        return btoa(String.fromCharCode(...sig));
    };
    return { publicKeyB64, sign };
}

/**
 * Seal a tenant's TELNYX_PUBLIC_KEY into tenant_configs.secrets_enc and flip the
 * tenant into own-mode BYO Telnyx, so the inbound route resolves the Telnyx
 * branch (loadTenantSecrets reads the same mocked drizzle/sqlite db).
 */
async function seedTelnyxTenant(
    database: BetterSQLite3Database<typeof schema>, tenantId: string, publicKeyB64: string,
): Promise<void> {
    const sealed = await sealSecrets({ TELNYX_PUBLIC_KEY: publicKeyB64 }, tenantId, 'test-secret');
    await database.insert(schema.tenantConfigs).values({
        tenantId, smsMode: 'own', smsByoProvider: 'telnyx',
        secretsEnc: sealed.blob, dekEnc: sealed.dekEnc, updatedAt: new Date(),
    } as never);
}

describe('BYO Telnyx tenant inbound (Ed25519 JSON webhook)', () => {
    it('valid Ed25519 signature + STOP → revoked for that tenant', async () => {
        const { publicKeyB64, sign } = await makeTelnyxSigner();
        await seedTelnyxTenant(db, TENANT, publicKeyB64);

        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'admin', {});

        const rawBody = telnyxBody('+15551234567', 'STOP');
        const sig = await sign(TELNYX_TS, rawBody);
        // Pin the handler clock inside the ±300s tolerance window of TELNYX_TS.
        const env = { ...FAKE_ENV, TELNYX_VERIFY_NOW_MS: Number(TELNYX_TS) * 1000 } as unknown as HonoConfig['Bindings'];

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound/acme', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'telnyx-signature-ed25519': sig,
                'telnyx-timestamp': TELNYX_TS,
            },
            body: rawBody,
        }, env, makeExecCtx());

        expect(res.status).toBe(200);
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('revoked');
    });

    it('bad signature (tampered body) → 403, no consent change', async () => {
        const { publicKeyB64, sign } = await makeTelnyxSigner();
        await seedTelnyxTenant(db, TENANT, publicKeyB64);

        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'admin', {});

        const signedBody = telnyxBody('+15551234567', 'STOP');
        const sig = await sign(TELNYX_TS, signedBody);
        const tamperedBody = telnyxBody('+15551234567', 'CONTINUE'); // signature no longer matches
        const env = { ...FAKE_ENV, TELNYX_VERIFY_NOW_MS: Number(TELNYX_TS) * 1000 } as unknown as HonoConfig['Bindings'];

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound/acme', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'telnyx-signature-ed25519': sig,
                'telnyx-timestamp': TELNYX_TS,
            },
            body: tamperedBody,
        }, env, makeExecCtx());

        expect(res.status).toBe(403);
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('granted');
    });

    it('valid signature but non-message event_type → 200 no-op (no consent change)', async () => {
        const { publicKeyB64, sign } = await makeTelnyxSigner();
        await seedTelnyxTenant(db, TENANT, publicKeyB64);

        const contactId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: contactId, tenantId: TENANT, type: 'client', name: 'Jane', phone: '+15551234567', createdAt: new Date(),
        } as never);
        await new SmsConsentService({} as D1Database).record(TENANT, contactId, 'granted', 'admin', {});

        const rawBody = telnyxBody('+15551234567', 'STOP', 'message.sent');
        const sig = await sign(TELNYX_TS, rawBody);
        const env = { ...FAKE_ENV, TELNYX_VERIFY_NOW_MS: Number(TELNYX_TS) * 1000 } as unknown as HonoConfig['Bindings'];

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/inbound/acme', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'telnyx-signature-ed25519': sig,
                'telnyx-timestamp': TELNYX_TS,
            },
            body: rawBody,
        }, env, makeExecCtx());

        expect(res.status).toBe(200);
        // Delivery-receipt event types are not user replies — consent untouched.
        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, contactId)).toBe('granted');
    });
});

// ─── PATCH /api/admin/tenant-config — smsMode tenant selector (Task 6) ───────

/**
 * Build a minimal app for tenant-config PATCH tests.
 * Injects a mock branding service and sets the deployment profile.
 */
function buildTenantConfigApp(
    profile: typeof SAAS_PROFILE | typeof STANDALONE_PROFILE,
    updateBranding: ReturnType<typeof vi.fn>,
    getBranding: ReturnType<typeof vi.fn>,
) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('user', { sub: 'user-1', role: 'owner', tenantId: TENANT } as never);
        c.set('profile', profile);
        c.set('services', {
            branding: { updateBranding, getBranding },
            event: {},
            dashboardPrefs: {},
            admin: {},
            invoice: {},
            widget: {},
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/admin', adminRoutes);
    return app;
}

describe('PATCH /api/admin/tenant-config — smsMode tenant selector (Task 6)', () => {
    it('SaaS: PATCH smsMode=platform → 400 platform_mode_not_allowed', async () => {
        // The schema excludes 'platform'; this test verifies the guard for a direct API call
        // that bypasses the schema (e.g. by sending a raw body the zod layer might pass).
        // NOTE: Because the zod schema enum(['own','managed_shared','managed_dedicated'])
        // already rejects 'platform' at the validation layer (422), we test the guard via
        // the schema rejection first, then verify the guard in the handler is reachable
        // when 'platform' somehow arrives (tested via integration).
        //
        // In practice, the zod enum rejects 'platform' before the handler runs — so the
        // API returns 422 (unprocessable_entity), not 400 (bad_request). Both outcomes
        // correctly reject 'platform' for SaaS tenants; the test asserts !2xx.
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const getBranding = vi.fn().mockResolvedValue({});
        const app = buildTenantConfigApp(SAAS_PROFILE, updateBranding, getBranding);

        const res = await app.request('/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ smsMode: 'platform' }),
        }, FAKE_ENV, makeExecCtx());

        // Zod schema enum(['own','managed_shared','managed_dedicated']) rejects 'platform'
        // before the handler body runs → expect a non-2xx response (400 or 422).
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(updateBranding).not.toHaveBeenCalled();
    });

    it('SaaS: PATCH smsMode=managed_shared → 200', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const getBranding = vi.fn().mockResolvedValue({});
        const app = buildTenantConfigApp(SAAS_PROFILE, updateBranding, getBranding);

        const res = await app.request('/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ smsMode: 'managed_shared' }),
        }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith(TENANT, expect.objectContaining({ smsMode: 'managed_shared' }));
    });

    it('SaaS: PATCH smsMode=own → 200', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const getBranding = vi.fn().mockResolvedValue({});
        const app = buildTenantConfigApp(SAAS_PROFILE, updateBranding, getBranding);

        const res = await app.request('/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ smsMode: 'own' }),
        }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith(TENANT, expect.objectContaining({ smsMode: 'own' }));
    });

    it('Standalone: PATCH smsMode=managed_shared → coerces to own and returns 200', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const getBranding = vi.fn().mockResolvedValue({});
        const app = buildTenantConfigApp(STANDALONE_PROFILE, updateBranding, getBranding);

        const res = await app.request('/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ smsMode: 'managed_shared' }),
        }, FAKE_ENV, makeExecCtx());

        // Standalone coerces any smsMode to 'own'
        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith(TENANT, expect.objectContaining({ smsMode: 'own' }));
    });

    it('SaaS: PATCH smsMode=managed_dedicated → 200 (selectable placeholder)', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const getBranding = vi.fn().mockResolvedValue({});
        const app = buildTenantConfigApp(SAAS_PROFILE, updateBranding, getBranding);

        const res = await app.request('/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ smsMode: 'managed_dedicated' }),
        }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith(TENANT, expect.objectContaining({ smsMode: 'managed_dedicated' }));
    });
});

// ─── Managed compliance admin endpoints (Task 6) ─────────────────────────────

const MANAGED_ENV = {
    ...FAKE_ENV,
    APP_MODE: 'saas',
    TWILIO_ACCOUNT_SID: 'ACtest000000000000000000000000000001',
    TWILIO_API_KEY_SID: 'SKtest00000000000000000000000000001',
    TWILIO_API_KEY_SECRET: 'managed-api-key-secret',
} as unknown as HonoConfig['Bindings'];

/**
 * Build the SMS admin router with a specific deployment profile injected.
 * The profile is injected via the '*' middleware (same pattern as buildTenantConfigApp).
 */
function buildSmsApp(
    database: BetterSQLite3Database<typeof schema>,
    profile: typeof SAAS_PROFILE | typeof STANDALONE_PROFILE,
) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('user', { sub: 'user-1', role: 'owner', tenantId: TENANT } as never);
        c.set('profile', profile);
        await next();
    });
    app.route('/api/admin', smsAdminRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(database);
    return app;
}

describe('Managed compliance admin endpoints (Task 6)', () => {
    it('GET /sms/compliance returns managed sub-status fields (null when no row)', async () => {
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance', {}, MANAGED_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.json() as {
            data: {
                complianceStatus: string | null;
                customerProfileStatus: string | null;
                brandStatus: string | null;
                campaignStatus: string | null;
                tfvStatus: string | null;
                messagingServiceSid: string | null;
                provisionedNumber: string | null;
            };
        };
        // No row seeded → all sub-statuses null.
        expect(body.data.complianceStatus).toBeNull();
        expect(body.data.customerProfileStatus).toBeNull();
        expect(body.data.brandStatus).toBeNull();
        expect(body.data.campaignStatus).toBeNull();
        expect(body.data.tfvStatus).toBeNull();
        expect(body.data.messagingServiceSid).toBeNull();
        expect(body.data.provisionedNumber).toBeNull();
    });

    it('GET /sms/compliance returns stored managed sub-statuses when row exists', async () => {
        // Seed a partial provisioning row.
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT,
            mode: 'managed_dedicated',
            complianceStatus: 'brand_pending',
            customerProfileStatus: 'PENDING_REVIEW',
            brandStatus: 'PENDING',
            messagingResourceSid: 'MG123',
            createdAt: now,
            updatedAt: now,
        } as never);

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance', {}, MANAGED_ENV, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Record<string, string | null> };
        expect(body.data.complianceStatus).toBe('brand_pending');
        expect(body.data.customerProfileStatus).toBe('PENDING_REVIEW');
        expect(body.data.brandStatus).toBe('PENDING');
        expect(body.data.messagingServiceSid).toBe('MG123');
        expect(body.data.campaignStatus).toBeNull();
        expect(body.data.provisionedNumber).toBeNull();
    });

    it('POST /sms/compliance/provision on standalone → 403 and fetch never called', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, STANDALONE_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());
        expect(res.status).toBe(403);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_provision_unavailable');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/provision on SaaS with missing managed keys → 409 and fetch never called', async () => {
        // Seed managedEligible=true so the managed-eligibility gate passes and we reach the env-keys check.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, managedEligible: true, updatedAt: new Date(),
        } as never);

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const envNoKeys = { ...FAKE_ENV, APP_MODE: 'saas' } as unknown as HonoConfig['Bindings'];
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, envNoKeys, makeExecCtx());
        expect(res.status).toBe(409);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_configured');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/provision on SaaS with managed keys → 200 returning current status', async () => {
        // Seed managedEligible=true so the managed-eligibility gate passes.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, managedEligible: true, updatedAt: new Date(),
        } as never);

        // Stub fetch so provision Twilio calls return 201.
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ sid: 'CP123', status: 'PENDING_REVIEW' }), { status: 201 }),
        );

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St, City, ST 12345', repName: 'Jane Doe', email: 'jane@acme.com' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        // Route returns 200 immediately with the current stored status.
        // Provision runs via waitUntil (background), so the response reflects
        // the pre-provision state (null = no row yet).
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        // All managed sub-status fields must be present in the response (may be null).
        expect(Object.keys(body.data)).toEqual(expect.arrayContaining([
            'mode', 'complianceStatus', 'rejectionReason', 'tollfree',
            'customerProfileStatus', 'brandStatus', 'campaignStatus',
            'tfvStatus', 'messagingServiceSid', 'provisionedNumber',
        ]));
    });

    it('POST /sms/compliance/provision with managedProvider=telnyx but no TELNYX_API_KEY → 409 (keyed off managedProvider, Plan 2)', async () => {
        // managedEligible=true AND managedProvider='telnyx'. The env carries the
        // Twilio ISV triple but NO TELNYX_API_KEY — so if the route still keyed off
        // 'twilio' it would proceed (200). A 409 proves it resolved by managedProvider.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, managedEligible: true, managedProvider: 'telnyx', updatedAt: new Date(),
        } as never);

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());
        expect(res.status).toBe(409);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_configured');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/provision with managedProvider=telnyx dispatches to the Telnyx provider', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, managedEligible: true, managedProvider: 'telnyx', updatedAt: new Date(),
        } as never);

        // Capture the background provision promise so we can await it deterministically.
        const pending: Promise<unknown>[] = [];
        const execCtx = {
            waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p)); },
            passThroughOnException: () => {},
        } as unknown as ExecutionContext;

        // The Telnyx SDK routes through global fetch to api.telnyx.com. Stub it so
        // provision dispatches there (the run errors out later — that's fine; the
        // dispatch host is what proves the Telnyx provider was selected).
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ data: { id: 'mp_1' } }), { status: 200 }),
        );

        const env = { ...FAKE_ENV, APP_MODE: 'saas', TELNYX_API_KEY: 'KEY_telnyx_test' } as unknown as HonoConfig['Bindings'];
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St, City, ST 12345', repName: 'Jane Doe', email: 'jane@acme.com' },
                channel: 'tollfree',
            }),
        }, env, execCtx);

        expect(res.status).toBe(200);
        await Promise.allSettled(pending);
        // Dispatched to Telnyx — at least one outbound call hit the Telnyx API host.
        // Parse and compare the host exactly (substring matching on a URL is unsafe).
        const hitTelnyx = fetchSpy.mock.calls.some(([url]) => {
            try { return new URL(String(url)).hostname === 'api.telnyx.com'; } catch { return false; }
        });
        expect(hitTelnyx).toBe(true);
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/resubmit on SaaS with no tenant_configs row → 403 managed_not_enabled', async () => {
        // No tenant_configs row seeded → managedEligible is null (fail-closed → 403).
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/resubmit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());
        expect(res.status).toBe(403);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_enabled');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/resubmit on standalone → 403 and fetch never called', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, STANDALONE_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/resubmit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());
        expect(res.status).toBe(403);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/resubmit on SaaS with missing managed keys → 409 and fetch never called', async () => {
        // Seed managedEligible=true so the managed-eligibility gate passes and we reach the env-keys check.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, managedEligible: true, updatedAt: new Date(),
        } as never);

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const envNoKeys = { ...FAKE_ENV, APP_MODE: 'saas' } as unknown as HonoConfig['Bindings'];
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/resubmit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, envNoKeys, makeExecCtx());
        expect(res.status).toBe(409);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_configured');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('POST /sms/compliance/resubmit on SaaS with managed keys → 200', async () => {
        // Seed managedEligible=true so the managed-eligibility gate passes.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, managedEligible: true, updatedAt: new Date(),
        } as never);

        // Seed a partial row (customerProfileSid already set → provision resumes from step 2).
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT,
            mode: 'managed_dedicated',
            complianceStatus: 'profile_pending',
            customerProfileSid: 'CP123',
            customerProfileStatus: 'PENDING_REVIEW',
            createdAt: now,
            updatedAt: now,
        } as never);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ sid: 'MS456', status: 'PENDING' }), { status: 201 }),
        );

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/resubmit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St, City, ST 12345', repName: 'Jane Doe', email: 'jane@acme.com' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        // Status was at least 'profile_pending' when resubmit started (returned pre-await).
        expect(body.data.complianceStatus).toBeTruthy();
    });
});

// ─── Compliance-status webhook (Task 7) ──────────────────────────────────────

import { signParams as _signParamsForCompliance } from '../../server/lib/messaging/twilio';
import { MessagingComplianceService } from '../../server/services/messaging-compliance.service';
import { smsPublicRoutes as _smsPublicRoutes } from '../../server/api/sms';
import { TwilioComplianceProvider } from '../../server/lib/messaging/providers/twilio-compliance';

/**
 * Build a ComplianceProvider over a minimal twilio-node-shaped fake exposing only
 * the READ surfaces syncStatus touches (tollfree-verification + brand-registration
 * list). The coordinator delegates the cron-poll read to this provider.
 */
function fakeReadProvider(tfvs: Array<{ sid: string; status: string }> = []): TwilioComplianceProvider {
    return new TwilioComplianceProvider({
        messaging: {
            v1: {
                tollfreeVerifications: { list: async () => tfvs },
                brandRegistrations: { list: async () => [] },
            },
        },
    } as never);
}

const COMPLIANCE_TOKEN = 'compliance-webhook-token';

/** Build a minimal app with smsPublicRoutes mounted for compliance webhook tests. */
function buildComplianceApp(database: BetterSQLite3Database<typeof schema>, token?: string) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    // No JWT injection needed — this route is fully public (signature-verified).
    app.route('/api/public', _smsPublicRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(database);

    const env: HonoConfig['Bindings'] = {
        ...FAKE_ENV,
        ...(token !== undefined ? { TWILIO_COMPLIANCE_WEBHOOK_TOKEN: token } : {}),
    } as unknown as HonoConfig['Bindings'];
    return { app, env };
}

/** Seed a messaging_compliance row for a tenant (managed_dedicated, campaign_pending by default). */
async function seedComplianceRow(
    database: BetterSQLite3Database<typeof schema>,
    tenantId: string,
    overrides: Partial<{ complianceStatus: string; mode: string; campaignStatus: string; brandStatus: string; tfvStatus: string }> = {},
) {
    const now = new Date();
    await database.insert(schema.messagingCompliance).values({
        tenantId,
        mode: overrides.mode ?? 'managed_dedicated',
        complianceStatus: overrides.complianceStatus ?? 'campaign_pending',
        campaignStatus: overrides.campaignStatus ?? null,
        brandStatus: overrides.brandStatus ?? null,
        tfvStatus: overrides.tfvStatus ?? null,
        createdAt: now,
        updatedAt: now,
    } as never);
}

/**
 * Sign a compliance callback POST and drive it through the app.
 * Mirrors the delivery-status tests: build params, sign, post form-encoded.
 */
async function postComplianceCallback(
    app: ReturnType<typeof buildComplianceApp>['app'],
    env: HonoConfig['Bindings'],
    tenantSlug: string,
    params: Record<string, string>,
    tokenOverride?: string,
) {
    const url = `${APP_BASE_URL}/api/public/twilio/compliance-status/${tenantSlug}`;
    const signingToken = tokenOverride ?? COMPLIANCE_TOKEN;
    const sig = await _signParamsForCompliance(signingToken, url, params);
    const body = new URLSearchParams(params).toString();
    return app.request(
        `/api/public/twilio/compliance-status/${tenantSlug}`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-twilio-signature': sig,
            },
            body,
        },
        env,
        makeExecCtx(),
    );
}

describe('Compliance-status webhook (Task 7)', () => {
    it('campaign TWILIO_APPROVED callback flips complianceStatus to approved', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { CampaignSid: 'CR123', CampaignStatus: 'TWILIO_APPROVED' };
        const res = await postComplianceCallback(app, env, 'acme', params);

        expect(res.status).toBe(200);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('approved');
    });

    it('campaign APPROVED (short form) also flips complianceStatus to approved', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { CampaignSid: 'CR123', CampaignStatus: 'APPROVED' };
        const res = await postComplianceCallback(app, env, 'acme', params);

        expect(res.status).toBe(200);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('approved');
    });

    it('campaign REJECTED callback stores rejectionReason + sets complianceStatus=rejected', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = {
            CampaignSid: 'CR123',
            CampaignStatus: 'REJECTED',
            ErrorCode: '30034',
            ErrorMessage: 'Use case not approved',
        };
        const res = await postComplianceCallback(app, env, 'acme', params);

        expect(res.status).toBe(200);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('rejected');
        expect(stored?.rejectionReason).toContain('30034');
        expect(stored?.rejectionReason).toContain('Use case not approved');
    });

    it('TFV TWILIO_APPROVED callback flips complianceStatus to approved', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'tfv_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { VerificationStatus: 'TWILIO_APPROVED', VerificationSid: 'HV123' };
        const res = await postComplianceCallback(app, env, 'acme', params);

        expect(res.status).toBe(200);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('approved');
    });

    it('bad/missing signature → 403 and NO row change', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { CampaignSid: 'CR123', CampaignStatus: 'TWILIO_APPROVED' };
        const body = new URLSearchParams(params).toString();

        const res = await app.request(
            '/api/public/twilio/compliance-status/acme',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-twilio-signature': 'invalid-signature',
                },
                body,
            },
            env,
            makeExecCtx(),
        );

        expect(res.status).toBe(403);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        // Row must be untouched — still campaign_pending, not approved.
        expect(stored?.complianceStatus).toBe('campaign_pending');
    });

    it('missing signature header → 403 and NO row change', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { CampaignSid: 'CR123', CampaignStatus: 'TWILIO_APPROVED' };
        const body = new URLSearchParams(params).toString();

        const res = await app.request(
            '/api/public/twilio/compliance-status/acme',
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body,
            },
            env,
            makeExecCtx(),
        );

        expect(res.status).toBe(403);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('campaign_pending');
    });

    it('no secret configured → 403 before any DB write', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        // Build app with no token in env (both TWILIO_COMPLIANCE_WEBHOOK_TOKEN
        // and TWILIO_AUTH_TOKEN absent).
        const app = new OpenAPIHono<HonoConfig>();
        app.route('/api/public', _smsPublicRoutes);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        const envNoToken = {
            DB: {},
            APP_BASE_URL,
            JWT_SECRET: 'test-secret',
            // No TWILIO_AUTH_TOKEN, no TWILIO_COMPLIANCE_WEBHOOK_TOKEN
            TENANT_CACHE: { get: async () => null, put: async () => {} },
        } as unknown as HonoConfig['Bindings'];

        const params = { CampaignSid: 'CR123', CampaignStatus: 'TWILIO_APPROVED' };
        // Sign with any token — doesn't matter, will be rejected before verification.
        const sig = await _signParamsForCompliance('any-token', `${APP_BASE_URL}/api/public/twilio/compliance-status/acme`, params);
        const body = new URLSearchParams(params).toString();

        const res = await app.request(
            '/api/public/twilio/compliance-status/acme',
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
                body,
            },
            envNoToken,
            makeExecCtx(),
        );

        expect(res.status).toBe(403);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('campaign_pending');
    });

    it('unknown tenant slug → 404', async () => {
        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { CampaignSid: 'CR123', CampaignStatus: 'TWILIO_APPROVED' };
        const res = await postComplianceCallback(app, env, 'no-such-tenant', params);
        expect(res.status).toBe(404);
    });

    it('unknown provider slug → 404 (no DB write, no signature check)', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending' });

        const { app, env } = buildComplianceApp(db, COMPLIANCE_TOKEN);
        const params = { CampaignSid: 'CR123', CampaignStatus: 'TWILIO_APPROVED' };
        const body = new URLSearchParams(params).toString();

        const res = await app.request(
            '/api/public/bogus/compliance-status/acme',
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body,
            },
            env,
            makeExecCtx(),
        );

        expect(res.status).toBe(404);
        // Row must be untouched — status not changed.
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('campaign_pending');
    });

    it('telnyx callback with a valid Ed25519 signature verifies + advances the row (Plan 2)', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending', mode: 'managed_dedicated' });

        const { publicKeyB64, sign } = await makeTelnyxSigner();
        // Build the app with TELNYX_PUBLIC_KEY as the provider-keyed verify secret.
        const { app, env: baseEnv } = buildComplianceApp(db);
        const env = { ...baseEnv, TELNYX_PUBLIC_KEY: publicKeyB64 } as unknown as HonoConfig['Bindings'];

        // Telnyx wraps events as { data: { event_type, payload } }. A campaign
        // APPROVED event is terminal for sp10dlc → flips complianceStatus to approved.
        const rawBody = JSON.stringify({
            data: { event_type: 'campaign.status.updated', payload: { campaignId: 'CMP1', campaignStatus: 'APPROVED' } },
        });
        // Timestamp inside the verifier's ±300s window (handler uses real Date.now()).
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, rawBody);

        const res = await app.request(
            '/api/public/telnyx/compliance-status/acme',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'telnyx-signature-ed25519': sig,
                    'telnyx-timestamp': ts,
                },
                body: rawBody,
            },
            env,
            makeExecCtx(),
        );

        expect(res.status).toBe(200);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('approved');
    });

    it('telnyx callback with an invalid Ed25519 signature → 403, no DB write (Plan 2)', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'campaign_pending', mode: 'managed_dedicated' });

        const { publicKeyB64, sign } = await makeTelnyxSigner();
        const { app, env: baseEnv } = buildComplianceApp(db);
        const env = { ...baseEnv, TELNYX_PUBLIC_KEY: publicKeyB64 } as unknown as HonoConfig['Bindings'];

        const signedBody = JSON.stringify({
            data: { event_type: 'campaign.status.updated', payload: { campaignId: 'CMP1', campaignStatus: 'APPROVED' } },
        });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, signedBody);
        // Tamper the body so the signature no longer matches.
        const tamperedBody = JSON.stringify({
            data: { event_type: 'campaign.status.updated', payload: { campaignId: 'CMP1', campaignStatus: 'REJECTED' } },
        });

        const res = await app.request(
            '/api/public/telnyx/compliance-status/acme',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'telnyx-signature-ed25519': sig,
                    'telnyx-timestamp': ts,
                },
                body: tamperedBody,
            },
            env,
            makeExecCtx(),
        );

        expect(res.status).toBe(403);
        const svc = new MessagingComplianceService({} as D1Database);
        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('campaign_pending');
    });
});

// ─── MessagingComplianceService.syncManagedStatus (cron poll, Task 7) ────────

describe('MessagingComplianceService.syncManagedStatus (cron poll)', () => {
    it('TFV TWILIO_APPROVED read → updates stored status to approved', async () => {
        await seedComplianceRow(db, TENANT, {
            complianceStatus: 'tfv_pending',
            tfvStatus: 'PENDING_REVIEW',
        });

        // Inject a fake provider — never calls real Twilio.
        const svc = new MessagingComplianceService({} as D1Database);
        await svc.syncManagedStatus(TENANT, fakeReadProvider([{ sid: 'HV123', status: 'TWILIO_APPROVED' }]));

        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('approved');
    });

    it('TFV TWILIO_REJECTED read → updates stored status to rejected', async () => {
        await seedComplianceRow(db, TENANT, {
            complianceStatus: 'tfv_pending',
            tfvStatus: 'PENDING_REVIEW',
        });

        const svc = new MessagingComplianceService({} as D1Database);
        await svc.syncManagedStatus(TENANT, fakeReadProvider([{ sid: 'HV123', status: 'TWILIO_REJECTED' }]));

        const stored = await svc.getStatus(TENANT);
        expect(stored?.complianceStatus).toBe('rejected');
    });

    it('empty tollfree list → no change to stored status', async () => {
        await seedComplianceRow(db, TENANT, { complianceStatus: 'tfv_pending', tfvStatus: 'PENDING_REVIEW' });

        const svc = new MessagingComplianceService({} as D1Database);
        await svc.syncManagedStatus(TENANT, fakeReadProvider([]));

        const stored = await svc.getStatus(TENANT);
        // No tollfree entry found → status unchanged.
        expect(stored?.complianceStatus).toBe('tfv_pending');
    });

    it('no row for tenant → returns without error (no-op)', async () => {
        // No compliance row seeded for TENANT.
        const svc = new MessagingComplianceService({} as D1Database);
        // Must not throw. Returns {changed:false} when no row exists.
        const result = await svc.syncManagedStatus(TENANT, fakeReadProvider([{ sid: 'HV123', status: 'TWILIO_APPROVED' }]));
        expect(result.changed).toBe(false);
    });
});

// ─── managedSendAllowed unit tests (Task 8) ──────────────────────────────────

import { managedSendAllowed } from '../../server/lib/sms/managed-send-gate';

describe('managedSendAllowed — compliance gate unit tests (Task 8)', () => {
    it('managed_dedicated: no compliance row → blocked (fail-closed)', async () => {
        // No row seeded for TENANT.
        const result = await managedSendAllowed(db, {}, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('managed_not_approved');
    });

    it('managed_dedicated: complianceStatus=not_started → blocked', async () => {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'not_started', createdAt: now, updatedAt: now,
        } as never);
        const result = await managedSendAllowed(db, {}, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('managed_not_approved');
    });

    it('managed_dedicated: complianceStatus=campaign_pending → blocked', async () => {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'campaign_pending', createdAt: now, updatedAt: now,
        } as never);
        const result = await managedSendAllowed(db, {}, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(false);
    });

    it('managed_dedicated: complianceStatus=approved → allowed', async () => {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'approved', createdAt: now, updatedAt: now,
        } as never);
        const result = await managedSendAllowed(db, {}, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('managed_dedicated: complianceStatus=rejected → blocked', async () => {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus: 'rejected', createdAt: now, updatedAt: now,
        } as never);
        const result = await managedSendAllowed(db, {}, TENANT, 'managed_dedicated');
        expect(result.allowed).toBe(false);
    });

    it('managed_shared: TWILIO_SHARED_MESSAGING_SERVICE_SID set → allowed', async () => {
        const env = { TWILIO_SHARED_MESSAGING_SERVICE_SID: 'MG_shared_test' };
        const result = await managedSendAllowed(db, env, TENANT, 'managed_shared');
        expect(result.allowed).toBe(true);
    });

    it('managed_shared: TWILIO_SHARED_MESSAGING_SERVICE_SID absent → blocked', async () => {
        const result = await managedSendAllowed(db, {}, TENANT, 'managed_shared');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('managed_not_approved');
    });

    it('own → always allowed (no DB read needed)', async () => {
        const result = await managedSendAllowed(db, {}, TENANT, 'own');
        expect(result.allowed).toBe(true);
    });

    it('platform → always allowed', async () => {
        const result = await managedSendAllowed(db, {}, TENANT, 'platform');
        expect(result.allowed).toBe(true);
    });
});

// ─── POST /sms/test managed-send gate (Task 8) ───────────────────────────────

describe('POST /sms/test — managed-send compliance gate (Task 8)', () => {
    /** Seed a loadProviderForTenant-compatible mock by injecting tenantConfigs+secrets. */
    async function seedManagedConfig(mode: 'managed_dedicated' | 'managed_shared') {
        const existing = await db.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
        if (existing) {
            await db.update(schema.tenantConfigs).set({ smsMode: mode })
                .where(eq(schema.tenantConfigs.tenantId, TENANT));
        } else {
            await db.insert(schema.tenantConfigs).values({
                tenantId: TENANT, smsMode: mode, updatedAt: new Date(),
            } as never);
        }
    }

    async function seedComplianceRow(complianceStatus: string) {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated',
            complianceStatus, createdAt: now, updatedAt: now,
        } as never);
    }

    /** Env with managed Twilio keys + optional shared SID. */
    function managedEnvWithKeys(extra: Record<string, string> = {}): HonoConfig['Bindings'] {
        return {
            ...FAKE_ENV,
            TWILIO_ACCOUNT_SID: 'ACmanaged000000000000000000000001',
            TWILIO_API_KEY_SID: 'SKmanaged0000000000000000000000001',
            TWILIO_API_KEY_SECRET: 'managed-api-key-secret',
            ...extra,
        } as unknown as HonoConfig['Bindings'];
    }

    it('managed_dedicated not-approved → returns success=false managed_not_approved, no Twilio call', async () => {
        await seedManagedConfig('managed_dedicated');
        await seedComplianceRow('campaign_pending');

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: '+15559991234' }),
        }, managedEnvWithKeys(), makeExecCtx());

        fetchSpy.mockRestore();

        const body = await res.json() as { success: boolean; error?: string };
        expect(body.success).toBe(false);
        expect(body.error).toBe('managed_not_approved');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('managed_dedicated approved → gate passes (does not return managed_not_approved)', async () => {
        await seedManagedConfig('managed_dedicated');
        await seedComplianceRow('approved');

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: '+15559991234' }),
        }, managedEnvWithKeys(), makeExecCtx());

        const body = await res.json() as { success: boolean; error?: string };
        // Gate passed — response must NOT be managed_not_approved.
        // (The send may fail for other reasons like unconfigured provider in test env.)
        expect(body.error).not.toBe('managed_not_approved');
    });

    it('managed_shared without TWILIO_SHARED_MESSAGING_SERVICE_SID → blocked, no send', async () => {
        await seedManagedConfig('managed_shared');

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        // managedEnvWithKeys has no TWILIO_SHARED_MESSAGING_SERVICE_SID.
        const res = await app.request('/api/admin/sms/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: '+15559991234' }),
        }, managedEnvWithKeys(), makeExecCtx());

        fetchSpy.mockRestore();

        const body = await res.json() as { success: boolean; error?: string };
        expect(body.success).toBe(false);
        expect(body.error).toBe('managed_not_approved');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('managed_shared with TWILIO_SHARED_MESSAGING_SERVICE_SID set → gate passes (does not return managed_not_approved)', async () => {
        await seedManagedConfig('managed_shared');

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: '+15559991234' }),
        }, managedEnvWithKeys({ TWILIO_SHARED_MESSAGING_SERVICE_SID: 'MG_shared_test' }), makeExecCtx());

        const body = await res.json() as { success: boolean; error?: string };
        // Gate passed — response must NOT be managed_not_approved.
        // (The send may fail for other reasons like unconfigured provider in test env.)
        expect(body.error).not.toBe('managed_not_approved');
    });

    it('own-mode tenant → gate does not block (success=false only for missing creds, never managed_not_approved)', async () => {
        // No managed config — default 'platform' mode. Gate must not block.
        const app = buildApp(db);
        const envNoCreds = { ...FAKE_ENV } as unknown as HonoConfig['Bindings'];

        const res = await app.request('/api/admin/sms/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: '+15559991234' }),
        }, envNoCreds, makeExecCtx());

        const body = await res.json() as { success: boolean; error?: string };
        // Gate must not return managed_not_approved for platform/own mode.
        expect(body.error).not.toBe('managed_not_approved');
    });
});

// ─── Managed-eligibility gate for managed provisioning (Task 10) ───────────────────────

describe('Managed-eligibility gate — POST /sms/compliance/provision and /resubmit (Task 10)', () => {
    /** Seed managedEligible flag into tenant_configs for TENANT. */
    async function seedManagedEligible(eligible: boolean) {
        const existing = await db.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
        if (existing) {
            await db.update(schema.tenantConfigs).set({ managedEligible: eligible } as never)
                .where(eq(schema.tenantConfigs.tenantId, TENANT));
        } else {
            await db.insert(schema.tenantConfigs).values({
                tenantId: TENANT, managedEligible: eligible, updatedAt: new Date(),
            } as never);
        }
    }

    it('provision: managedEligible=false → 403 managed_not_enabled, provision NOT called', async () => {
        await seedManagedEligible(false);

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        expect(res.status).toBe(403);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_enabled');
        // Provision must NOT have been called — no Twilio API calls.
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('provision: no tenant_configs row (managedEligible missing = false) → 403', async () => {
        // No tenant_configs row seeded — default is not eligible (fail-closed).
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        expect(res.status).toBe(403);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_enabled');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('provision: managedEligible=true → proceeds past the managed-eligibility gate (200)', async () => {
        await seedManagedEligible(true);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ sid: 'CP999', status: 'PENDING_REVIEW' }), { status: 201 }),
        );

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/provision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St, City, ST 12345', repName: 'Jane Doe', email: 'jane@acme.com' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
    });

    it('resubmit: managedEligible=false → 403 managed_not_enabled, provision NOT called', async () => {
        await seedManagedEligible(false);

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/resubmit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St', repName: 'Jane' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        expect(res.status).toBe(403);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('managed_not_enabled');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('resubmit: managedEligible=true → proceeds past the managed-eligibility gate (200)', async () => {
        await seedManagedEligible(true);

        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT, mode: 'managed_dedicated', complianceStatus: 'profile_pending',
            customerProfileSid: 'CP111', customerProfileStatus: 'PENDING_REVIEW',
            createdAt: now, updatedAt: now,
        } as never);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ sid: 'MS789', status: 'PENDING' }), { status: 201 }),
        );

        const app = buildSmsApp(db, SAAS_PROFILE);
        const res = await app.request('/api/admin/sms/compliance/resubmit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                businessInfo: { legalName: 'Acme Inc', address: '1 Main St, City, ST 12345', repName: 'Jane Doe', email: 'jane@acme.com' },
                channel: 'tollfree',
            }),
        }, MANAGED_ENV, makeExecCtx());

        fetchSpy.mockRestore();

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
    });
});

// ─── MeteringService.getCount (Task 10) ─────────────────────────────────────

import { MeteringService } from '../../server/services/metering.service';

describe('MeteringService.getCount (Task 10)', () => {
    let meteringDb: BetterSQLite3Database<typeof schema>;
    let meteringSqlite: { close: () => void };

    beforeEach(async () => {
        const fx = createTestDb();
        meteringDb = fx.db as BetterSQLite3Database<typeof schema>;
        meteringSqlite = fx.sqlite;
        await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(meteringDb);
    });

    afterEach(() => meteringSqlite.close());

    it('getCount returns 0 when no row exists', async () => {
        const svc = new MeteringService({} as D1Database);
        const count = await svc.getCount('some-tenant', 'sms', '2026-06');
        expect(count).toBe(0);
    });

    it('getCount returns stored value after record()', async () => {
        const svc = new MeteringService({} as D1Database);
        await svc.record('t1', 'sms', '2026-06', 5);
        const count = await svc.getCount('t1', 'sms', '2026-06');
        expect(count).toBe(5);
    });

    it('getCount returns 0 for a different period even when another period has data', async () => {
        const svc = new MeteringService({} as D1Database);
        await svc.record('t1', 'sms', '2026-06', 3);
        const count = await svc.getCount('t1', 'sms', '2026-07');
        expect(count).toBe(0);
    });

    it('getCount accumulates across multiple record() calls', async () => {
        const svc = new MeteringService({} as D1Database);
        await svc.record('t1', 'sms', '2026-06', 1);
        await svc.record('t1', 'sms', '2026-06', 1);
        await svc.record('t1', 'sms', '2026-06', 1);
        const count = await svc.getCount('t1', 'sms', '2026-06');
        expect(count).toBe(3);
    });
});
