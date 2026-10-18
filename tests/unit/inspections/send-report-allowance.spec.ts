/**
 * The hourly allowance counts reports DELIVERED, not reports asked for.
 *
 * `guardSendReport` used to spend the allowance before the handler ran, so a
 * recipient whose send a downstream gate refused (cooling window 403, plan cap
 * 402) was answered "already sent several times in the last hour" after three
 * refusals, though nothing had ever been delivered. The text-message guard
 * already says a refused request spends nothing; this holds the report guard to
 * the same promise, without reopening the double-click hole: the allowance is
 * reserved before the send (so two clicks in flight cannot both pass) and given
 * back for every recipient that was not actually delivered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { PeopleService } from '../../../server/services/people.service';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { seedSendGuardFixture, guardKv } from '../helpers/send-guard-fixture';
import type { MockKV } from '../mocks';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const CO_CLIENT = 'contact-client-2';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

let db: BetterSQLite3Database<typeof schema>;
let sendPdf: ReturnType<typeof vi.fn>;
let kv: MockKV;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', 'acme' as never);
        c.set('services', {
            inspection: {
                getInspection: vi.fn().mockResolvedValue({ inspection: { propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID } }),
                getReportContentHash: vi.fn().mockResolvedValue('hash-1'),
            },
            people: new PeopleService({ DB: {} as D1Database }),
            portalAccess: { issueToken: vi.fn().mockResolvedValue('tok') },
            reportPdf: {
                getOrRender: vi.fn().mockResolvedValue({ key: 'k' }),
                streamPdf: vi.fn().mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }),
            },
            email: { sendReportReady: vi.fn().mockResolvedValue(true), sendInspectionReportPdf: sendPdf },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        return c.json({ success: false, error: { code: 'INTERNAL', message: String(err) } }, 500);
    });
    return app;
}

const CTX = makeExecutionContext().ctx;
const env = () => ({ DB: {}, APP_BASE_URL: 'https://acme.example.com', JWT_SECRET: 's', TENANT_CACHE: kv as unknown as KVNamespace }) as never;

function send(recipients: Array<{ contactId: string; roleKey: string }>) {
    return buildApp().fetch(new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-report-pdf`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipients }),
    }), env(), CTX);
}
const one = () => send([{ contactId: CLIENT, roleKey: 'client' }]);
const both = () => send([{ contactId: CLIENT, roleKey: 'client' }, { contactId: CO_CLIENT, roleKey: 'co_client' }]);
const counter = async (email: string) => Number(await kv.get(`sendlimit:${TENANT}:${INSP_ID}:${email}`) ?? '0');

describe('send-report-pdf hourly allowance', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@example.com', createdAt: new Date() },
            { id: CO_CLIENT, tenantId: TENANT, type: 'client', name: 'Joe', email: 'joe@example.com', createdAt: new Date() },
        ]);
        await seedSendGuardFixture(db, TENANT, INSP_ID, [
            { contactId: CLIENT, roleKey: 'client' },
            { contactId: CO_CLIENT, roleKey: 'co_client' },
        ]);
        kv = guardKv() as unknown as MockKV;
        sendPdf = vi.fn().mockResolvedValue(true);
    });

    it('positive control: delivered sends are counted and the 4th is refused with 429', async () => {
        for (let i = 0; i < 3; i++) expect((await one()).status).toBe(200);
        expect(await counter('jane@example.com')).toBe(3);
        const res = await one();
        expect(res.status).toBe(429);
        expect(sendPdf).toHaveBeenCalledTimes(3);
    });

    it.each([
        ['a cooling window (403)', () => new AppError(403, ErrorCode.FORBIDDEN, 'cooling')],
        ['the plan cap (402)', () => new AppError(402, ErrorCode.QUOTA_EXHAUSTED, 'cap')],
    ])('%s spends nothing, however many times it is refused', async (_label, makeErr) => {
        sendPdf.mockRejectedValue(makeErr());
        for (let i = 0; i < 5; i++) {
            const res = await one();
            expect([402, 403]).toContain(res.status);
        }
        expect(await counter('jane@example.com')).toBe(0);
        // ...and once the gate opens the very next send is delivered, not rate limited.
        sendPdf.mockResolvedValue(true);
        expect((await one()).status).toBe(200);
        expect(await counter('jane@example.com')).toBe(1);
    });

    it('a provider failure for one recipient spends nothing for that recipient only', async () => {
        sendPdf.mockImplementation(async (to: string) => {
            if (to === 'joe@example.com') throw new Error('provider down');
            return true;
        });
        const res = await both();
        expect(res.status).toBe(200);
        expect(await counter('jane@example.com')).toBe(1);
        expect(await counter('joe@example.com')).toBe(0);
    });

    it('a recipient with no email on file at send time spends nothing', async () => {
        await db.update(schema.contacts).set({ email: null }).where(eq(schema.contacts.id, CO_CLIENT));
        const res = await both();
        expect(res.status).toBe(200);
        expect(await counter('jane@example.com')).toBe(1);
        expect(await counter('joe@example.com')).toBe(0);
    });

    it('a request refused by a guard before any send spends nothing (unknown recipient)', async () => {
        const res = await send([{ contactId: 'not-on-this-inspection', roleKey: 'client' }]);
        expect(res.status).toBe(400);
        expect(await counter('jane@example.com')).toBe(0);
    });

    it('simultaneous clicks cannot exceed the allowance', async () => {
        // Hold every send open so all the requests are in flight at once.
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        sendPdf.mockImplementation(async () => { await gate; return true; });

        const inFlight = Array.from({ length: 6 }, () => one());
        // Let every request pass its guard and reach the send.
        await new Promise((r) => setTimeout(r, 50));
        release();
        const statuses = (await Promise.all(inFlight)).map((r) => r.status);

        expect(statuses.filter((s) => s === 200)).toHaveLength(3);
        expect(statuses.filter((s) => s === 429)).toHaveLength(3);
        expect(sendPdf).toHaveBeenCalledTimes(3);
        expect(await counter('jane@example.com')).toBe(3);
    });
});
