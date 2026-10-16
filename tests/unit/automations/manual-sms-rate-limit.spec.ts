/**
 * POST /api/inspections/{id}/send-sms carries the same send ceiling as the
 * report-send endpoints: at most ten people per request, each person at most
 * three times per hour per inspection, and a refused request spends nothing.
 * It used to carry only the assignment check, so one caller could text the same
 * phone as often as they liked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const sendMessage = vi.fn();
// Partial mock: only the provider loader is replaced, so other exports of the
// module (which the send gate also imports) stay real.
vi.mock('../../../server/lib/sms/resolve-twilio', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../server/lib/sms/resolve-twilio')>()),
    loadProviderForTenant: vi.fn(async () => ({
        provider: { sendMessage },
        from: '+15550001111',
        messagingServiceSid: null,
    })),
}));

import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import { PeopleService } from '../../../server/services/people.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const AGENT = 'ct-rl-agent';
const AGENT_2 = 'ct-rl-agent2';
const INSP_ID = '550e8400-e29b-41d4-a716-4466554400d1';
const OTHER_INSP = '550e8400-e29b-41d4-a716-4466554400d2';
const SLUG = 'acme-rl';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let kv: Map<string, string>;

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
                getInspection: vi.fn(async (id: string) => ({
                    inspection: {
                        id, propertyAddress: '1 Main St', date: '2026-07-30',
                        status: 'scheduled', reportStatus: 'draft', paymentStatus: 'unpaid',
                        inspectorId: null,
                    },
                })),
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

const CTX = makeExecutionContext().ctx;

function env() {
    return {
        DB: {}, APP_BASE_URL: 'https://acme.example.com', APP_NAME: 'Acme Inspect', JWT_SECRET: 'test-secret',
        TENANT_CACHE: {
            get: async (k: string) => kv.get(k) ?? null,
            put: async (k: string, v: string) => { kv.set(k, v); },
        },
    } as never;
}

function send(recipients: Array<{ contactId: string; roleKey: string }>, inspectionId = INSP_ID) {
    return buildApp().fetch(new Request(`https://acme.example.com/api/inspections/${inspectionId}/send-sms`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipients }),
    }), env(), CTX);
}
const agent = (contactId = AGENT) => [{ contactId, roleKey: 'buyer_agent' }];

describe('send-sms send ceiling', () => {
    beforeEach(async () => {
        kv = new Map();
        sendMessage.mockReset();
        sendMessage.mockResolvedValue({ ok: true, id: 'SM1' });
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: SLUG, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, companyPhone: '+15550009999', smsMode: 'platform', updatedAt: new Date(),
        } as never);
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: AGENT, tenantId: TENANT, type: 'agent', name: 'Ray', email: 'r@x.com', phone: '+15551110003', createdAt: new Date() },
            { id: AGENT_2, tenantId: TENANT, type: 'agent', name: 'Rita', email: 'rita@x.com', phone: '+15551110004', createdAt: new Date() },
        ]);
        for (const id of [INSP_ID, OTHER_INSP]) {
            await db.insert(schema.inspections).values({
                id, tenantId: TENANT, propertyAddress: '1 Main St', status: 'scheduled',
                reportStatus: 'draft', paymentStatus: 'unpaid', date: '2026-07-30', createdAt: new Date(),
            } as never);
            for (const contactId of [AGENT, AGENT_2]) {
                await db.insert(schema.inspectionPeople).values({
                    id: `ip-${id}-${contactId}`, tenantId: TENANT, inspectionId: id, contactId,
                    roleProfileId: roleProfileId('buyer_agent'), createdAt: new Date(),
                });
            }
        }
    });

    it('allows three texts to one person per hour and refuses the fourth with 429', async () => {
        for (let i = 0; i < 3; i += 1) expect((await send(agent())).status).toBe(200);
        expect(sendMessage).toHaveBeenCalledTimes(3);
        expect((await send(agent())).status).toBe(429);
        expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    it('controls: another person and another inspection have their own allowance', async () => {
        for (let i = 0; i < 3; i += 1) await send(agent());
        expect((await send(agent(AGENT_2))).status).toBe(200);
        expect((await send(agent(), OTHER_INSP)).status).toBe(200);
    });

    it('refuses more than ten recipients and the same person twice, spending nothing', async () => {
        const many = Array.from({ length: 11 }, (_, i) => ({ contactId: `ct-x${i}`, roleKey: 'buyer_agent' }));
        expect((await send(many)).status).toBe(400);
        expect((await send([...agent(), ...agent()])).status).toBe(400);
        expect(sendMessage).not.toHaveBeenCalled();
        // the refused requests above spent nothing: three real sends still go through
        for (let i = 0; i < 3; i += 1) expect((await send(agent())).status).toBe(200);
    });

    const counter = (contactId: string) => kv.get(`sendlimit:${TENANT}:${INSP_ID}:sms:${contactId}`);

    it('spends allowance only for texts actually sent: a consent-skipped recipient spends nothing', async () => {
        await new SmsConsentService({} as D1Database).record(TENANT, AGENT_2, 'revoked', 'admin', {});
        const res = await send([...agent(), ...agent(AGENT_2)]);
        expect(res.status).toBe(200);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(counter(AGENT)).toBe('1');
        expect(counter(AGENT_2)).toBeUndefined();
    });

    it('spends nothing for a recipient who is not seated or has no phone', async () => {
        const res = await send([{ contactId: 'ct-stranger', roleKey: 'buyer_agent' }, ...agent()]);
        expect(res.status).toBe(200);
        expect(counter('ct-stranger')).toBeUndefined();
        expect(counter(AGENT)).toBe('1');
    });

    it('a mixed request refused for one recipient spends nothing for the others', async () => {
        for (let i = 0; i < 3; i += 1) await send(agent());
        sendMessage.mockClear();
        const res = await send([...agent(AGENT_2), ...agent()]);
        expect(res.status).toBe(429);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(counter(AGENT_2)).toBeUndefined();
        expect(counter(AGENT)).toBe('3');
    });

    it('words the 429 for a text message, not a report', async () => {
        for (let i = 0; i < 3; i += 1) await send(agent());
        const body = await (await send(agent())).json() as { error: { message: string } };
        expect(body.error.message).toMatch(/text/i);
        expect(body.error.message).not.toMatch(/report/i);
    });

    it('rejects an oversized contact id with 400 rather than a KV key error', async () => {
        const res = await send([{ contactId: 'x'.repeat(600), roleKey: 'buyer_agent' }]);
        expect(res.status).toBe(400);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('control: an empty recipient list is still a 400 from the schema', async () => {
        expect((await send([])).status).toBe(400);
    });
});
