/**
 * Communication A3.4 / A3.5 — manual SMS endpoint.
 *
 * Critical cases (write-first, watch red):
 *   - kind:'client' with no recorded consent must NOT send
 *   - co_client without their own consent must NOT send (IA-109 still holds
 *     after the sendOneSms extraction)
 *   - agent (implied) with a phone DOES send
 *   - free-typed / unseated contact is rejected before any ledger write
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, isNull, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

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
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const CLIENT = 'ct-sms-client';
const CO_CLIENT = 'ct-sms-coclien';
const AGENT = 'ct-sms-agent';
const NO_PHONE = 'ct-sms-nophone';
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
                        id: INSP_ID,
                        propertyAddress: '1 Main St',
                        date: '2026-07-30',
                        status: 'scheduled',
                        reportStatus: 'draft',
                        paymentStatus: 'unpaid',
                        inspectorId: null,
                    },
                }),
            },
            people: new PeopleService({ DB: {} as D1Database }),
        } as never);
        await next();
    });
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
    DB: {},
    APP_BASE_URL: 'https://acme.example.com',
    APP_NAME: 'Acme Inspect',
    JWT_SECRET: 'test-secret',
} as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function post(body: unknown) {
    return new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-sms`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

async function manualSmsRows() {
    return db.select().from(schema.automationLogs).where(and(
        eq(schema.automationLogs.inspectionId, INSP_ID),
        isNull(schema.automationLogs.automationId),
        eq(schema.automationLogs.channel, 'sms'),
    ));
}

async function seat(contactId: string, roleKey: string) {
    await db.insert(schema.inspectionPeople).values({
        id: `ip-${contactId}`,
        tenantId: TENANT,
        inspectionId: INSP_ID,
        contactId,
        roleProfileId: roleProfileId(roleKey),
        createdAt: new Date(),
    });
}

describe('manual SMS send (A3.4/A3.5)', () => {
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
            tenantId: TENANT,
            companyPhone: '+15550009999',
            reviewUrl: 'https://reviews.example',
            smsMode: 'platform',
            updatedAt: new Date(),
        } as never);
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane', email: 'j@x.com', phone: '+15551110001', createdAt: new Date() },
            { id: CO_CLIENT, tenantId: TENANT, type: 'client', name: 'John', email: 'h@x.com', phone: '+15551110002', createdAt: new Date() },
            { id: AGENT, tenantId: TENANT, type: 'agent', name: 'Ray', email: 'r@x.com', phone: '+15551110003', createdAt: new Date() },
            { id: NO_PHONE, tenantId: TENANT, type: 'client', name: 'Mute', email: 'm@x.com', phone: null, createdAt: new Date() },
        ]);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St', status: 'scheduled',
            reportStatus: 'draft', paymentStatus: 'unpaid', date: '2026-07-30', createdAt: new Date(),
        } as never);
        await seat(CLIENT, 'client');
        await seat(CO_CLIENT, 'co_client');
        await seat(AGENT, 'buyer_agent');
        await seat(NO_PHONE, 'client');
    });

    it('kind:client with NO consent → skipped, provider never called', async () => {
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: CLIENT, roleKey: 'client' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { sentTo: string[]; skipped?: Array<{ reason: string }> } };
        expect(body.data.sentTo).toEqual([]);
        expect(body.data.skipped?.[0]?.reason).toMatch(/consent/i);
        expect(sendMessage).not.toHaveBeenCalled();

        const rows = await manualSmsRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('skipped');
        expect(rows[0].automationId).toBeNull();
        expect(rows[0].recipientContactId).toBe(CLIENT);
    });

    it('co_client without THEIR consent → skipped even if primary has consent', async () => {
        const consent = new SmsConsentService({} as D1Database);
        await consent.publishDisclosure('d');
        await consent.record(TENANT, CLIENT, 'granted', 'admin', {});
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: CO_CLIENT, roleKey: 'co_client' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendMessage).not.toHaveBeenCalled();
        const rows = await manualSmsRows();
        expect(rows[0].status).toBe('skipped');
        expect(rows[0].error).toMatch(/consent/i);
    });

    it('client WITH consent → sent once and metered path reachable', async () => {
        const consent = new SmsConsentService({} as D1Database);
        await consent.publishDisclosure('d');
        await consent.record(TENANT, CLIENT, 'granted', 'admin', {});
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: CLIENT, roleKey: 'client' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { sentTo: string[] } };
        expect(body.data.sentTo).toEqual(['+15551110001']);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const rows = await manualSmsRows();
        expect(rows[0].status).toBe('sent');
        expect(rows[0].channel).toBe('sms');
    });

    it('agent (implied consent) with phone → sent without a ledger grant', async () => {
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: AGENT, roleKey: 'buyer_agent' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const rows = await manualSmsRows();
        expect(rows[0].status).toBe('sent');
        expect(rows[0].recipientRoleKey).toBe('buyer_agent');
    });

    // A revocation binds EVERY recipient, whatever basis the first message was
    // sent under. This is the one CTIA requirement that is not
    // consent-basis-dependent, and both published documents warrant it: the ToS
    // says STOP is honored "for all outbound recipients" and the privacy notice
    // tells business counterparties that "STOP remains available".
    //
    // Before this, the whole ledger lookup — revocation included — sat inside
    // the express-consent branch, which is client-kind only. The STOP webhook
    // matches contacts by PHONE with no kind filter, so an agent's STOP was
    // recorded and then ignored: the revocation existed in the ledger and the
    // texts kept going out.
    it('agent who replied STOP → skipped, even though agents need no express consent', async () => {
        await new SmsConsentService({} as D1Database).record(TENANT, AGENT, 'revoked', 'admin', {});

        const res = await buildApp().fetch(post({
            recipients: [{ contactId: AGENT, roleKey: 'buyer_agent' }],
        }), ENV, CTX);

        expect(res.status).toBe(200);
        expect(sendMessage).not.toHaveBeenCalled();
        const rows = await manualSmsRows();
        expect(rows[0].status).toBe('skipped');
        expect(rows[0].error).toMatch(/opt.?out/i);
    });

    it('agent who replied STOP and then START → sends again', async () => {
        const svc = new SmsConsentService({} as D1Database);
        await svc.record(TENANT, AGENT, 'revoked', 'admin', {});
        await svc.record(TENANT, AGENT, 'granted', 'admin', {});

        const res = await buildApp().fetch(post({
            recipients: [{ contactId: AGENT, roleKey: 'buyer_agent' }],
        }), ENV, CTX);

        expect(res.status).toBe(200);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('no phone on file → skipped before provider, no ledger row written for that path', async () => {
        // Seated but phoneless: rejected before insert so the Outbox stays clean.
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: NO_PHONE, roleKey: 'client' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { skipped?: Array<{ reason: string }> } };
        expect(body.data.skipped?.[0]?.reason).toMatch(/phone/i);
        expect(await manualSmsRows()).toHaveLength(0);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('contact not seated on the inspection → rejected, no ledger row', async () => {
        await db.insert(schema.contacts).values({
            id: 'ct-stranger', tenantId: TENANT, type: 'client', name: 'X',
            email: 'x@x.com', phone: '+15551119999', createdAt: new Date(),
        });
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: 'ct-stranger', roleKey: 'client' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        expect(await manualSmsRows()).toHaveLength(0);
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
