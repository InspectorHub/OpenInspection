/**
 * An inbound STOP has to reach WHOEVER holds that number.
 *
 * The webhook resolved candidates out of `contacts` alone, so a number that
 * belongs to a staff member matched nothing, the consent loop ran zero times,
 * and the provider still got its `<Response/>` 200 — a STOP that is refused is
 * visible, a STOP that is recorded nowhere is not. Staff receive SMS under an
 * IMPLIED basis, which makes an honoured STOP the only way out they have.
 *
 * The second thing pinned here is the BASIS the row is stamped with. Every
 * inbound row said `recipient_type = 'client'`, agents included, so any count of
 * consumer opt-out evidence filtered on that column counted business
 * counterparties as consumers.
 *
 * ── Where the webhook payload shape comes from ──────────────────────────────
 * `From` / `Body` form-encoded with an `X-Twilio-Signature` computed by
 * `signParams` is taken from the existing inbound cases in
 * `tests/unit/messaging/sms-api.spec.ts`, which is the same shape
 * `handleInbound` parses (`server/api/sms.ts`). Nothing here invents a
 * provider payload.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Imported AFTER the mock is registered.
// eslint-disable-next-line import/order
import { smsWebhookRoutes } from '../../../server/api/sms';
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import { signParams } from '../../../server/lib/sms/send-sms';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000a2';
const APP_BASE_URL = 'https://app.example.test';
const PLATFORM_TOKEN = 'platform-auth-token';
const PHONE = '+15557654321';

const FAKE_ENV = {
    DB: {},
    APP_BASE_URL,
    JWT_SECRET: 'test-secret',
    TWILIO_AUTH_TOKEN: PLATFORM_TOKEN,
    TENANT_CACHE: { get: async () => null, put: async () => {} },
} as unknown as HonoConfig['Bindings'];

/** One context for the file, not one per call. `makeExecutionContext` registers
 *  the teardown that settles background work, and `afterEach` is only
 *  registrable while a suite is being COLLECTED -- building a fresh context
 *  inside a test would silently settle nothing. */
const EXEC_CTX = makeExecutionContext().ctx;
const execCtx = () => EXEC_CTX;

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('profile', STANDALONE_PROFILE);
        await next();
    });
    app.route('/webhooks', smsWebhookRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    return app;
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: OTHER_TENANT, slug: 'beta', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ] as never);
    await new SmsConsentService({} as D1Database).publishDisclosure('disclosure v1');
});
afterEach(() => sqlite.close());

async function seedContact(
    id: string, tenantId: string, type: 'client' | 'agent' | 'other', phone: string | null,
) {
    await db.insert(schema.contacts).values({
        id, tenantId, type, name: id, phone, createdAt: new Date(),
    } as never);
}

async function seedUser(id: string, tenantId: string, phone: string | null) {
    await db.insert(schema.users).values({
        id, tenantId, email: `${id}@example.test`, passwordHash: 'x',
        name: id, phone, role: 'inspector', createdAt: new Date(),
    } as never);
}

/** POST the provider's inbound shape at the tenant-scoped or platform route. */
async function inbound(path: string, body: string) {
    const params = { From: PHONE, Body: body };
    const sig = await signParams(PLATFORM_TOKEN, `${APP_BASE_URL}${path}`, params);
    return buildApp().request(path, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'X-Twilio-Signature': sig,
        },
        body: new URLSearchParams(params).toString(),
    }, FAKE_ENV, execCtx());
}

const rows = (tenantId = TENANT) =>
    db.select().from(schema.smsConsentLog)
        .where(eq(schema.smsConsentLog.tenantId, tenantId)).all();

describe('inbound STOP — every subject the number stands for', () => {
    it('records a STOP from a staff member, who has no contact row at all', async () => {
        await seedUser('u-staff', TENANT, PHONE);

        const res = await inbound('/webhooks/sms/inbound/acme', 'STOP');
        expect(res.status).toBe(200);

        const written = await rows();
        expect(written.length).toBe(1);
        expect(written[0]!.subjectKind).toBe('user');
        expect(written[0]!.subjectId).toBe('u-staff');
        // NULL, not the user id: a user id in the contact column would make the
        // column lie about what it holds.
        expect(written[0]!.contactId).toBeNull();
        expect(written[0]!.action).toBe('revoked');
        // Internal-operational under account terms, never consumer evidence.
        expect(written[0]!.recipientType).toBe('staff');
    });

    it('records against BOTH when one number is a contact and a user', async () => {
        // One person, two rows in two id spaces — the same case the signed
        // unsubscribe link already writes to every subject for. A half-applied
        // opt-out is worse than none.
        await seedContact('c-jane', TENANT, 'client', PHONE);
        await seedUser('u-jane', TENANT, PHONE);

        expect((await inbound('/webhooks/sms/inbound/acme', 'STOP')).status).toBe(200);

        const written = await rows();
        expect(written.length).toBe(2);
        expect(written.map((r) => `${r.subjectKind}:${r.subjectId}`).sort())
            .toEqual(['contact:c-jane', 'user:u-jane']);
        const svc = new SmsConsentService({} as D1Database);
        expect(await svc.getLatest(TENANT, 'c-jane', 'contact')).toBe('revoked');
        expect(await svc.getLatest(TENANT, 'u-jane', 'user')).toBe('revoked');
    });

    it('a START after a STOP puts a staff member back on', async () => {
        // Otherwise the webhook is a one-way door for the one audience that has
        // no consumer opt-in page to come back through.
        await seedUser('u-staff', TENANT, PHONE);
        await inbound('/webhooks/sms/inbound/acme', 'STOP');
        await inbound('/webhooks/sms/inbound/acme', 'START');

        expect(await new SmsConsentService({} as D1Database).getLatest(TENANT, 'u-staff', 'user'))
            .toBe('granted');
    });

    it('POSITIVE CONTROL — a contact-only STOP behaves exactly as it did', async () => {
        await seedContact('c-jane', TENANT, 'client', PHONE);

        expect((await inbound('/webhooks/sms/inbound/acme', 'STOP')).status).toBe(200);

        const written = await rows();
        expect(written.length).toBe(1);
        expect(written[0]!.subjectKind).toBe('contact');
        expect(written[0]!.subjectId).toBe('c-jane');
        expect(written[0]!.contactId).toBe('c-jane');
        expect(written[0]!.action).toBe('revoked');
        expect(written[0]!.recipientType).toBe('client');
        expect(written[0]!.capturedVia).toBe('admin');
    });

    it('the platform shape skips own-mode tenants for users, as it does for contacts', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: OTHER_TENANT, smsMode: 'own', updatedAt: new Date(),
        } as never);
        await seedUser('u-acme', TENANT, PHONE);
        await seedUser('u-beta', OTHER_TENANT, PHONE);

        expect((await inbound('/webhooks/sms/inbound', 'STOP')).status).toBe(200);

        const svc = new SmsConsentService({} as D1Database);
        expect(await svc.getLatest(TENANT, 'u-acme', 'user')).toBe('revoked');
        expect(await svc.getLatest(OTHER_TENANT, 'u-beta', 'user')).toBeNull();
    });

    it('a tenant-scoped STOP does not reach an identical number in another tenant', async () => {
        await seedUser('u-acme', TENANT, PHONE);
        await seedUser('u-beta', OTHER_TENANT, PHONE);

        await inbound('/webhooks/sms/inbound/acme', 'STOP');

        const svc = new SmsConsentService({} as D1Database);
        expect(await svc.getLatest(TENANT, 'u-acme', 'user')).toBe('revoked');
        expect(await svc.getLatest(OTHER_TENANT, 'u-beta', 'user')).toBeNull();
    });
});

describe('inbound STOP — the basis it is stamped with', () => {
    it.each([
        ['client', 'client'],
        ['agent', 'agent'],
        ['other', 'other'],
    ] as const)('a %s contact is recorded as recipient_type %s', async (type, expected) => {
        // The ledger says which basis the person was reachable under. Stamping
        // every inbound row 'client' makes the evidence wrong in the one
        // direction a carrier audit cares about — it inflates the consumer
        // opt-out count with business counterparties.
        await seedContact('c-1', TENANT, type, PHONE);

        await inbound('/webhooks/sms/inbound/acme', 'STOP');

        const row = await db.select().from(schema.smsConsentLog)
            .where(and(
                eq(schema.smsConsentLog.tenantId, TENANT),
                eq(schema.smsConsentLog.subjectId, 'c-1'),
            )).get();
        expect(row?.recipientType).toBe(expected);
    });
});
