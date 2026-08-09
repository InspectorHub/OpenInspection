/**
 * Tier 1: outbound SMS. The ledger's claim, verified before this was written:
 * Task 4's title said "email and SMS" but its Files list only ever named the
 * email builder, so there is NO service-level dedupe on the SMS path — nothing
 * resembling `buildEmailDedupe`. Confirmed by reading
 * server/api/inspections/send-sms.ts end to end: each call mints a fresh
 * `automation_logs` id, inserts a pending row, and hands it to `sendOneSms`.
 * Nothing consults whether this message already went out.
 *
 * The HTTP route, though, IS tenant-authenticated, so the global mount in
 * server/index.ts does span it — the two facts are not in conflict, and the
 * distinction matters: the guard contains a RETRIED REQUEST, while the missing
 * service-level dedupe means anything that reaches `sendOneSms` by another path
 * (the automation flush, a resend from the Outbox) is still on its own.
 *
 * A duplicate here costs money twice over — the carrier charges per segment and
 * the send meters against the tenant's quota — and, unlike email, it lands on a
 * phone that may be someone's personal number at 7am.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

/** The Twilio seam. "One SMS left the building" is counted here, not inferred. */
const sendMessage = vi.fn();
vi.mock('../../../server/lib/sms/resolve-twilio', () => ({
    loadProviderForTenant: vi.fn(async () => ({
        provider: { sendMessage },
        from: '+15550001111',
        messagingServiceSid: null,
    })),
}));

import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { PeopleService } from '../../../server/services/people.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { asD1Db } from '../helpers/test-db';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const AGENT = 'ct-sms-agent';
const AGENT_2 = 'ct-sms-agent2';
const INSP_ID = '550e8400-e29b-41d4-a716-4466554400c1';
const SLUG = 'acme-sms';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('profile', { hasUsageQuota: false } as never);
        c.set('services', {
            inspection: {
                getInspection: vi.fn().mockResolvedValue({
                    inspection: {
                        id: INSP_ID, propertyAddress: '1 Main St', date: '2026-07-30',
                        status: 'scheduled', reportStatus: 'draft', paymentStatus: 'unpaid',
                        inspectorId: null,
                    },
                }),
            },
            people: new PeopleService({ DB: {} as D1Database }),
        } as never);
        await next();
    });
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = {
    DB: {}, APP_BASE_URL: 'https://acme.example.com',
    APP_NAME: 'Acme Inspect', JWT_SECRET: 'test-secret',
} as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function sendSms(key: string | null, contactId = AGENT) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-sms`, {
            method: 'POST', headers,
            body: JSON.stringify({ recipients: [{ contactId, roleKey: 'buyer_agent' }] }),
        }),
        ENV, CTX,
    );
}

async function smsLedgerRows() {
    return db.select().from(schema.automationLogs).where(and(
        eq(schema.automationLogs.inspectionId, INSP_ID),
        isNull(schema.automationLogs.automationId),
        eq(schema.automationLogs.channel, 'sms'),
    )).all();
}

async function seat(contactId: string, roleKey: string) {
    await db.insert(schema.inspectionPeople).values({
        id: `ip-${contactId}`, tenantId: TENANT, inspectionId: INSP_ID,
        contactId, roleProfileId: roleProfileId(roleKey), createdAt: new Date(),
    });
}

beforeEach(async () => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ ok: true, id: 'SM1' });
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT, companyPhone: '+15550009999',
        reviewUrl: 'https://reviews.example', smsMode: 'platform', updatedAt: new Date(),
    } as never);
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
    // Agents carry implied consent, so the send is not gated on a ledger grant
    // and the duplicate is the only thing under test.
    await db.insert(schema.contacts).values([
        { id: AGENT, tenantId: TENANT, type: 'agent', name: 'Ray', email: 'r@x.com', phone: '+15551110003', createdAt: new Date() },
        { id: AGENT_2, tenantId: TENANT, type: 'agent', name: 'Rita', email: 'rita@x.com', phone: '+15551110004', createdAt: new Date() },
    ]);
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St', status: 'scheduled',
        reportStatus: 'draft', paymentStatus: 'unpaid', date: '2026-07-30', createdAt: new Date(),
    } as never);
    await seat(AGENT, 'buyer_agent');
    await seat(AGENT_2, 'buyer_agent');
});

describe("POST '/api/inspections/{id}/send-sms' — replay does not text twice", () => {
    it('reaches the carrier ONCE when the same key is posted twice', async () => {
        const first = await sendSms('sms-1');
        const second = await sendSms('sms-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('leaves ONE row in the SMS ledger', async () => {
        // The row is what the Outbox shows and what metering counts. A second
        // pending-then-sent row is a second billable message on the tenant's
        // account, presented to them as two separate sends.
        await sendSms('sms-1');
        await sendSms('sms-1');
        expect(await smsLedgerRows()).toHaveLength(1);
    });

    it('replays the original outcome, flagged', async () => {
        const first = await sendSms('sms-1');
        const second = await sendSms('sms-1');

        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('texts again under a fresh key — a deliberate second message still goes', async () => {
        await sendSms('sms-1');
        await sendSms('sms-2');
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(await smsLedgerRows()).toHaveLength(2);
    });

    it('refuses the key when the recipient changed under it', async () => {
        await sendSms('sms-1', AGENT);
        const res = await sendSms('sms-1', AGENT_2);

        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
        // Rita's phone was never dialled, and no ledger row claims it was.
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const rows = await smsLedgerRows();
        expect(rows.map(r => r.recipient)).toEqual(['+15551110003']);
    });
});
