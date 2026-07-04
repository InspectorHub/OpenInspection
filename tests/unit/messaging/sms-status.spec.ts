import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

/**
 * WH-2 — SMS delivery-status receiver (POST /sms/status/:tenant) + send-path
 * id-stamping. Mirrors the sms-api.spec harness: mock drizzle-orm/d1 → test
 * sqlite, mount smsPublicRoutes, drive app.request().
 */
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { smsPublicRoutes, recordSentStatus } from '../../../server/api/sms';
import { signParams } from '../../../server/lib/sms/send-sms';
import { sealSecrets } from '../../../server/lib/config-crypto';

const TENANT = '00000000-0000-0000-0000-000000000001';
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
    return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function buildApp(db: BetterSQLite3Database<typeof schema>) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.route('/api/public', smsPublicRoutes);
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
});

afterEach(() => sqlite.close());

function twilioForm(fields: Record<string, string>): string {
    return new URLSearchParams(fields).toString();
}

async function statusRow(sid: string) {
    return db.select().from(schema.smsDeliveryStatus)
        .where(and(eq(schema.smsDeliveryStatus.tenantId, TENANT), eq(schema.smsDeliveryStatus.providerMessageId, sid)))
        .get();
}

describe('WH-2 Twilio delivery-status receiver (POST /sms/status/:tenant)', () => {
    it('valid signature, MessageStatus=delivered → delivered row keyed on the SID', async () => {
        const sid = 'SM_delivered_1';
        const params = { MessageSid: sid, MessageStatus: 'delivered' };
        const url = `${APP_BASE_URL}/api/public/sms/status/acme`;
        const sig = await signParams(PLATFORM_TOKEN, url, params);

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/status/acme', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig },
            body: twilioForm(params),
        }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        const row = await statusRow(sid);
        expect(row?.status).toBe('delivered');
    });

    it('status advances forward (sent → delivered) but a terminal status is never downgraded', async () => {
        const sid = 'SM_rank';
        const url = `${APP_BASE_URL}/api/public/sms/status/acme`;
        const app = buildApp(db);

        // Distinct event ids come from the differing MessageStatus (SID:status), so
        // none is deduped. Clock advances so each is the newest arrival.
        const send = async (status: string, nowMs: number) => {
            const params = { MessageSid: sid, MessageStatus: status };
            const sig = await signParams(PLATFORM_TOKEN, url, params);
            const env = { ...FAKE_ENV, WEBHOOK_NOW_MS: nowMs } as unknown as HonoConfig['Bindings'];
            return app.request('/api/public/sms/status/acme', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig },
                body: twilioForm(params),
            }, env, makeExecCtx());
        };
        // Forward progression: sent → delivered advances.
        await send('sent', 1_000);
        await send('delivered', 2_000);
        expect((await statusRow(sid))?.status).toBe('delivered');

        // Out-of-order: a later `failed` callback must NOT downgrade a terminal
        // `delivered` (status-rank guard — delivered is final).
        const r3 = await send('failed', 3_000);
        expect(r3.status).toBe(200);
        expect((await statusRow(sid))?.status).toBe('delivered');
    });

    it('an OLDER event does not overwrite a newer status', async () => {
        const sid = 'SM_old';
        // Pre-seed a NEWER delivered row at a high clock.
        await db.insert(schema.smsDeliveryStatus).values({
            id: crypto.randomUUID(), tenantId: TENANT, providerMessageId: sid,
            status: 'delivered', errorCode: null, updatedAt: new Date(5_000_000_000_000),
        } as never);

        const params = { MessageSid: sid, MessageStatus: 'failed' };
        const url = `${APP_BASE_URL}/api/public/sms/status/acme`;
        const sig = await signParams(PLATFORM_TOKEN, url, params);
        // Pin the receiver clock to an OLDER time than the stored row.
        const env = { ...FAKE_ENV, WEBHOOK_NOW_MS: 1_000_000_000_000 } as unknown as HonoConfig['Bindings'];

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/status/acme', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig },
            body: twilioForm(params),
        }, env, makeExecCtx());

        expect(res.status).toBe(200);
        const row = await statusRow(sid);
        // Older event must NOT clobber the newer delivered status.
        expect(row?.status).toBe('delivered');
    });

    it('duplicate event_id → 200 no-op, no second write', async () => {
        const sid = 'SM_dup';
        const params = { MessageSid: sid, MessageStatus: 'sent' };
        const url = `${APP_BASE_URL}/api/public/sms/status/acme`;
        const sig = await signParams(PLATFORM_TOKEN, url, params);
        const app = buildApp(db);
        const send = () => app.request('/api/public/sms/status/acme', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig },
            body: twilioForm(params),
        }, FAKE_ENV, makeExecCtx());

        await send();
        // Tamper the stored row so a second write would be detectable.
        await db.update(schema.smsDeliveryStatus).set({ status: 'failed' })
            .where(eq(schema.smsDeliveryStatus.providerMessageId, sid));
        const res2 = await send();
        expect(res2.status).toBe(200);
        const row = await statusRow(sid);
        // The duplicate was a no-op → our tampered 'failed' survives (no re-upsert).
        expect(row?.status).toBe('failed');
        const ledger = await db.select().from(schema.processedWebhookEvents).all();
        expect(ledger.length).toBe(1);
    });

    it('bad signature → 403, no row written', async () => {
        const sid = 'SM_bad';
        const params = { MessageSid: sid, MessageStatus: 'delivered' };
        const app = buildApp(db);
        const res = await app.request('/api/public/sms/status/acme', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'wrong' },
            body: twilioForm(params),
        }, FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(403);
        expect(await statusRow(sid)).toBeFalsy();
    });

    it('unknown tenant slug → 404', async () => {
        const app = buildApp(db);
        const res = await app.request('/api/public/sms/status/nope', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'x' },
            body: twilioForm({ MessageSid: 'SM', MessageStatus: 'sent' }),
        }, FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(404);
    });
});

// ─── BYO Telnyx delivery-status (Ed25519 JSON) ──────────────────────────────

const TELNYX_TS = '1782000000';

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

async function seedTelnyxTenant(
    database: BetterSQLite3Database<typeof schema>, tenantId: string, publicKeyB64: string,
): Promise<void> {
    const sealed = await sealSecrets({ TELNYX_PUBLIC_KEY: publicKeyB64 }, tenantId, 'test-secret');
    await database.insert(schema.tenantConfigs).values({
        tenantId, smsMode: 'own', smsByoProvider: 'telnyx',
        secretsEnc: sealed.blob, dekEnc: sealed.dekEnc, updatedAt: new Date(),
    } as never);
}

function telnyxStatusBody(messageId: string, toStatus: string, eventType = 'message.finalized'): string {
    return JSON.stringify({
        data: {
            event_type: eventType,
            id: `evt_${messageId}_${toStatus}`,
            payload: { id: messageId, to: [{ status: toStatus }] },
        },
    });
}

describe('WH-2 Telnyx delivery-status receiver', () => {
    it('message.finalized with delivery_failed (valid Ed25519) → failed row', async () => {
        const { publicKeyB64, sign } = await makeTelnyxSigner();
        await seedTelnyxTenant(db, TENANT, publicKeyB64);

        const messageId = 'tlx_msg_1';
        const rawBody = telnyxStatusBody(messageId, 'delivery_failed');
        const sig = await sign(TELNYX_TS, rawBody);
        const env = { ...FAKE_ENV, TELNYX_VERIFY_NOW_MS: Number(TELNYX_TS) * 1000 } as unknown as HonoConfig['Bindings'];

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/status/acme', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'telnyx-signature-ed25519': sig,
                'telnyx-timestamp': TELNYX_TS,
            },
            body: rawBody,
        }, env, makeExecCtx());

        expect(res.status).toBe(200);
        const row = await statusRow(messageId);
        expect(row?.status).toBe('failed');
    });

    it('Telnyx bad signature → 403, no row', async () => {
        const { publicKeyB64, sign } = await makeTelnyxSigner();
        await seedTelnyxTenant(db, TENANT, publicKeyB64);

        const messageId = 'tlx_msg_bad';
        const signedBody = telnyxStatusBody(messageId, 'delivered');
        const sig = await sign(TELNYX_TS, signedBody);
        const tamperedBody = telnyxStatusBody(messageId, 'delivery_failed');
        const env = { ...FAKE_ENV, TELNYX_VERIFY_NOW_MS: Number(TELNYX_TS) * 1000 } as unknown as HonoConfig['Bindings'];

        const app = buildApp(db);
        const res = await app.request('/api/public/sms/status/acme', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'telnyx-signature-ed25519': sig,
                'telnyx-timestamp': TELNYX_TS,
            },
            body: tamperedBody,
        }, env, makeExecCtx());

        expect(res.status).toBe(403);
        expect(await statusRow(messageId)).toBeFalsy();
    });
});

// ─── 3b. send-path id-stamping ──────────────────────────────────────────────

describe('WH-2 send-path id-stamping (recordSentStatus)', () => {
    it('seeds a sent status row keyed on the returned id', async () => {
        const id = 'SM_seeded';
        await recordSentStatus(db, TENANT, id, 1_700_000_000_000);
        const row = await statusRow(id);
        expect(row?.status).toBe('sent');
        expect(row?.providerMessageId).toBe(id);
    });
});
