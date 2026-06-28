import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * WH-3 — tenant email-events receiver (in-process Hono harness, mirrors
 * sms-api.spec.ts): mock drizzle-orm/d1 → test sqlite, seal each tenant's webhook
 * secret into tenant_configs.secrets_enc via sealSecrets, then drive
 * POST /api/public/email/:provider/:tenant with synthetic signed payloads.
 */
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Imported AFTER the mock is registered.
// eslint-disable-next-line import/order
import { smsPublicRoutes } from '../../../server/api/sms';
import { sealSecrets } from '../../../server/lib/config-crypto';

const TENANT = '00000000-0000-0000-0000-000000000001';
const FIXED_NOW = 1_700_000_000_000; // ms — pins the anti-replay clock

const FAKE_ENV = {
    DB: {},
    JWT_SECRET: 'test-secret',
    TENANT_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
    WEBHOOK_NOW_MS: FIXED_NOW,
} as unknown as HonoConfig['Bindings'];

function makeExecCtx() {
    return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function buildApp(database: BetterSQLite3Database<typeof schema>) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.route('/api/public', smsPublicRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(database);
    return app;
}

async function seedTenant(database: BetterSQLite3Database<typeof schema>, id: string, slug: string) {
    await database.insert(schema.tenants).values({
        id, name: `T-${slug}`, slug, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
}

/** Seal a single webhook secret into the tenant's encrypted secrets bag. */
async function sealWebhookSecret(
    database: BetterSQLite3Database<typeof schema>, tenantId: string, key: string, value: string,
): Promise<void> {
    const sealed = await sealSecrets({ [key]: value }, tenantId, 'test-secret');
    await database.insert(schema.tenantConfigs).values({
        tenantId, secretsEnc: sealed.blob, dekEnc: sealed.dekEnc, updatedAt: new Date(),
    } as never);
}

// ── crypto helpers (sign synthetic payloads with the exact bytes) ───────────
function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}
async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

// Resend / Svix signing material.
const SVIX_KEY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const WHSEC = `whsec_${bytesToBase64(SVIX_KEY)}`;
async function svixHeaders(body: string, id: string, tsSeconds: number): Promise<Record<string, string>> {
    const sig = await hmacSha256(SVIX_KEY, `${id}.${tsSeconds}.${body}`);
    return {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': String(tsSeconds),
        'svix-signature': `v1,${bytesToBase64(sig)}`,
    };
}
function resendBody(type: string, email: string, opts: { id?: string; bounceType?: string } = {}): string {
    const data: Record<string, unknown> = { email_id: opts.id ?? 'e1', to: [email] };
    if (opts.bounceType) data.bounce = { type: opts.bounceType };
    return JSON.stringify({ type, created_at: '2026-06-27T10:00:00.000Z', data });
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

async function suppressions() {
    return db.select().from(schema.emailSuppressions).all();
}

describe('WH-3 email-events receiver — Resend (Svix HMAC)', () => {
    const tsSeconds = Math.floor(FIXED_NOW / 1000);

    it('hard bounce (valid signature) → one suppression row reason hard_bounce', async () => {
        await sealWebhookSecret(db, TENANT, 'RESEND_WEBHOOK_SECRET', WHSEC);
        const body = resendBody('email.bounced', 'Bounce@Example.com', { id: 'hb1', bounceType: 'Permanent' });
        const headers = await svixHeaders(body, 'msg_hb1', tsSeconds);

        const app = buildApp(db);
        const res = await app.request('/api/public/email/resend/acme',
            { method: 'POST', headers, body }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        const rows = await suppressions();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            tenantId: TENANT, email: 'bounce@example.com', reason: 'hard_bounce', sourceProvider: 'resend',
        });
    });

    it('complaint → one suppression row reason complaint', async () => {
        await sealWebhookSecret(db, TENANT, 'RESEND_WEBHOOK_SECRET', WHSEC);
        const body = resendBody('email.complained', 'spammer@example.com', { id: 'cp1' });
        const headers = await svixHeaders(body, 'msg_cp1', tsSeconds);

        const app = buildApp(db);
        const res = await app.request('/api/public/email/resend/acme',
            { method: 'POST', headers, body }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        const rows = await suppressions();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ reason: 'complaint', email: 'spammer@example.com' });
    });

    it('SOFT bounce → 200, NO suppression row', async () => {
        await sealWebhookSecret(db, TENANT, 'RESEND_WEBHOOK_SECRET', WHSEC);
        const body = resendBody('email.bounced', 'soft@example.com', { id: 'sb1', bounceType: 'Transient' });
        const headers = await svixHeaders(body, 'msg_sb1', tsSeconds);

        const app = buildApp(db);
        const res = await app.request('/api/public/email/resend/acme',
            { method: 'POST', headers, body }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        expect(await suppressions()).toHaveLength(0);
    });

    it('duplicate event id → 200 no-op, no second row', async () => {
        await sealWebhookSecret(db, TENANT, 'RESEND_WEBHOOK_SECRET', WHSEC);
        const body = resendBody('email.bounced', 'dup@example.com', { id: 'dup1', bounceType: 'Permanent' });
        const headers = await svixHeaders(body, 'msg_dup1', tsSeconds);

        const app = buildApp(db);
        const first = await app.request('/api/public/email/resend/acme',
            { method: 'POST', headers, body }, FAKE_ENV, makeExecCtx());
        expect(first.status).toBe(200);
        const second = await app.request('/api/public/email/resend/acme',
            { method: 'POST', headers, body }, FAKE_ENV, makeExecCtx());
        expect(second.status).toBe(200);

        expect(await suppressions()).toHaveLength(1);
    });

    it('bad signature → 403, no row', async () => {
        await sealWebhookSecret(db, TENANT, 'RESEND_WEBHOOK_SECRET', WHSEC);
        const body = resendBody('email.bounced', 'nope@example.com', { id: 'bad1', bounceType: 'Permanent' });
        const headers = await svixHeaders(body, 'msg_bad1', tsSeconds);
        headers['svix-signature'] = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // wrong

        const app = buildApp(db);
        const res = await app.request('/api/public/email/resend/acme',
            { method: 'POST', headers, body }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(403);
        expect(await suppressions()).toHaveLength(0);
    });

    it('unknown provider → 404', async () => {
        const app = buildApp(db);
        const res = await app.request('/api/public/email/bogus/acme',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(404);
    });

    it('unknown tenant → 404', async () => {
        const app = buildApp(db);
        const res = await app.request('/api/public/email/resend/ghost',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, FAKE_ENV, makeExecCtx());
        expect(res.status).toBe(404);
    });
});

describe('WH-3 email-events receiver — SendGrid (ECDSA P-256)', () => {
    it('hard bounce (in-test keypair, public key stored) → a suppression row', async () => {
        const tsSeconds = String(Math.floor(FIXED_NOW / 1000));
        const body = JSON.stringify([
            { event: 'bounce', email: 'HardBounce@Example.com', sg_event_id: 'sg_hb1', timestamp: Math.floor(FIXED_NOW / 1000) },
        ]);
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const sig = await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${tsSeconds}${body}`),
        );
        const spki = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
        await sealWebhookSecret(db, TENANT, 'SENDGRID_WEBHOOK_PUBLIC_KEY', spki);

        const app = buildApp(db);
        const res = await app.request('/api/public/email/sendgrid/acme', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-twilio-email-event-webhook-signature': bytesToBase64(new Uint8Array(sig)),
                'x-twilio-email-event-webhook-timestamp': tsSeconds,
            },
            body,
        }, FAKE_ENV, makeExecCtx());

        expect(res.status).toBe(200);
        const rows = await suppressions();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            reason: 'hard_bounce', email: 'hardbounce@example.com', sourceProvider: 'sendgrid', providerEventId: 'sg_hb1',
        });
    });
});
