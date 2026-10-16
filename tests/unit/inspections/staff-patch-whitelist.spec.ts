/**
 * What an office user (staff) may write through PATCH /api/inspections/:id, through
 * the real route. The pure rule is pinned in order-fields.spec.ts; this pins that the
 * route applies it before anything is written, audits what changed, and leaves the
 * other roles alone.
 *
 * Every refusal is paired with a request that goes through, and every staff
 * restriction with the same request made by a role it does not apply to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError, Errors } from '../../../server/lib/errors';
import { INSPECTION_STATUS } from '../../../server/lib/status/inspection-status';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const auditSpy = vi.fn();
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: (...args: unknown[]) => auditSpy(...args),
}));

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const LEAD = '00000000-0000-0000-0000-0000000000a1';
const OTHER = '00000000-0000-0000-0000-0000000000b2';
const INSP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

describe('PATCH /api/inspections/:id as staff', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        auditSpy.mockClear();
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values([
            { id: ACTOR, tenantId: TENANT, email: 'actor@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: LEAD, tenantId: TENANT, email: 'a@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: OTHER, tenantId: TENANT, email: 'b@example.com', passwordHash: 'h', createdAt: new Date() },
        ]);
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, defaultTimezone: 'UTC', updatedAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId: LEAD,
            status: INSPECTION_STATUS.SCHEDULED, reportStatus: REPORT_STATUS.IN_PROGRESS, paymentStatus: 'unpaid',
            price: 100, paymentRequired: true, agreementRequired: false, createdAt: new Date(),
        });
    });

    function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', role);
            c.set('user', { sub: ACTOR, role, tenantId: TENANT });
            c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
            c.set('services', {
                inspection: {
                    getInspection: async (id: string) => {
                        const inspection = await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();
                        if (!inspection) throw Errors.NotFound('Inspection not found');
                        return { inspection };
                    },
                    isInspectionPhotoKey: async () => true,
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);
        return app;
    }

    const patch = (app: ReturnType<typeof buildApp>, body: unknown) =>
        app.request(`/api/inspections/${INSP_ID}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }, FAKE_ENV);

    const readRow = () => db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
    const setRow = (values: Partial<typeof schema.inspections.$inferInsert>) =>
        db.update(schema.inspections).set(values).where(eq(schema.inspections.id, INSP_ID));

    describe('the order side', () => {
        it('writes price, address and reference number, and audits the field names but not the values', async () => {
            const res = await patch(buildApp('staff'), { price: 250, propertyAddress: '9 New Street', referenceNumber: 'REF-7' });
            expect(res.status).toBe(200);
            const row = await readRow();
            expect([row?.price, row?.propertyAddress, row?.referenceNumber]).toEqual([250, '9 New Street', 'REF-7']);
            expect(auditSpy).toHaveBeenCalledTimes(1);
            const [, action, entity, options] = auditSpy.mock.calls[0] as [unknown, string, string, { entityId: string; metadata: Record<string, unknown> }];
            expect([action, entity, options.entityId]).toEqual(['inspection.order_updated', 'inspection', INSP_ID]);
            expect(options.metadata).toEqual({ fields: 'price,propertyAddress,referenceNumber', count: 3 });
            expect(JSON.stringify(options.metadata)).not.toMatch(/9 New Street|REF-7|250/);
        });

        it('control: an inspector and an owner editing the same fields leave no staff audit row', async () => {
            for (const role of ['inspector', 'owner'] as const) {
                expect((await patch(buildApp(role), { propertyAddress: '8 Other Road' })).status, role).toBe(200);
            }
            expect(auditSpy).not.toHaveBeenCalled();
        });

        it('a refused request writes no audit row', async () => {
            expect((await patch(buildApp('staff'), { autoSignOnPublish: true })).status).toBe(403);
            expect(auditSpy).not.toHaveBeenCalled();
        });
    });

    describe('the inspection side', () => {
        const SIDE: Array<[string, unknown]> = [
            ['autoSignOnPublish', true], ['coverPhotoId', 'k1'], ['profileOverride', 'meridian'],
            ['badgeLayoutOverride', 'inline'], ['reportPhotoColumns', 2], ['requireDefectFieldsOverride', 'both'],
        ];

        it('refuses each key with 403 and writes nothing', async () => {
            const before = await readRow();
            for (const [key, value] of SIDE) {
                expect((await patch(buildApp('staff'), { [key]: value })).status, key).toBe(403);
            }
            expect(await readRow()).toEqual(before);
        });

        it('control: the same keys go through for an inspector', async () => {
            for (const [key, value] of SIDE) {
                expect((await patch(buildApp('inspector'), { [key]: value })).status, key).toBe(200);
            }
            expect((await readRow())?.autoSignOnPublish).toBe(true);
        });

        it('refuses a mixed body as a whole, order key included', async () => {
            const res = await patch(buildApp('staff'), { price: 999, profileOverride: 'meridian' });
            expect(res.status).toBe(403);
            const row = await readRow();
            expect([row?.price, row?.profileOverride]).toEqual([100, null]);
        });

        it('does not count a repeated stored value as a change', async () => {
            await setRow({ profileOverride: 'meridian' });
            const res = await patch(buildApp('staff'), { profileOverride: 'meridian', coverPhotoId: null, propertyAddress: '2 Elm Court' });
            expect(res.status).toBe(200);
            expect((await readRow())?.propertyAddress).toBe('2 Elm Court');
            // Control: changing that same key is refused.
            expect((await patch(buildApp('staff'), { profileOverride: 'classic' })).status).toBe(403);
        });
    });

    describe('status', () => {
        it('lets staff confirm a scheduled booking', async () => {
            expect((await patch(buildApp('staff'), { status: 'confirmed' })).status).toBe(200);
            expect((await readRow())?.status).toBe('confirmed');
        });

        it('refuses any status change out of completed, and a status that is not an order status', async () => {
            await setRow({ status: INSPECTION_STATUS.COMPLETED });
            for (const status of ['requested', 'scheduled', 'confirmed']) {
                expect((await patch(buildApp('staff'), { status })).status, status).toBe(403);
            }
            expect((await readRow())?.status).toBe(INSPECTION_STATUS.COMPLETED);
            await setRow({ status: INSPECTION_STATUS.SCHEDULED });
            expect((await patch(buildApp('staff'), { status: 'completed' })).status).toBe(403);
            expect((await readRow())?.status).toBe(INSPECTION_STATUS.SCHEDULED);
        });

        it('control: an owner moves a completed inspection back, and staff repeating the completed status is no change', async () => {
            await setRow({ status: INSPECTION_STATUS.COMPLETED });
            expect((await patch(buildApp('staff'), { status: 'completed', referenceNumber: 'R-9' })).status).toBe(200);
            expect((await patch(buildApp('owner'), { status: 'scheduled' })).status).toBe(200);
            expect((await readRow())?.status).toBe(INSPECTION_STATUS.SCHEDULED);
        });
    });

    describe('after the inspection has started', () => {
        const LOCKED: Array<[string, unknown]> = [['inspectorId', OTHER], ['propertyAddress', '3 Late Lane'], ['date', '2026-06-20']];

        async function expectLockedFor(role: UserRole) {
            const statuses: number[] = [];
            for (const [key, value] of LOCKED) statuses.push((await patch(buildApp(role), { [key]: value })).status);
            return statuses;
        }

        it.each([
            ['the report was submitted', () => setRow({ reportStatus: REPORT_STATUS.SUBMITTED })],
            ['the report was published', () => setRow({ reportStatus: REPORT_STATUS.PUBLISHED })],
            ['the visit is completed', () => setRow({ status: INSPECTION_STATUS.COMPLETED })],
            ['a results row holds a key', () => db.insert(schema.inspectionResults).values({
                id: 'res-1', tenantId: TENANT, inspectionId: INSP_ID, data: { item1: { rating: 'good' } }, lastSyncedAt: new Date(),
            })],
        ])('refuses staff the inspector, address and date once %s, and still allows a reference number', async (_name, start) => {
            await start();
            expect(await expectLockedFor('staff')).toEqual([403, 403, 403]);
            expect((await patch(buildApp('staff'), { referenceNumber: 'R-5' })).status).toBe(200);
            const row = await readRow();
            expect([row?.inspectorId, row?.propertyAddress, row?.date.slice(0, 10)]).toEqual([LEAD, '1 Main St', '2026-06-01']);
        });

        it('control: before it starts, the same three changes go through; an empty results row does not start it', async () => {
            await db.insert(schema.inspectionResults).values({
                id: 'res-0', tenantId: TENANT, inspectionId: INSP_ID, data: {}, lastSyncedAt: new Date(),
            });
            expect(await expectLockedFor('staff')).toEqual([200, 200, 200]);
        });

        it('control: an owner is not locked out of the same changes after the start', async () => {
            await setRow({ reportStatus: REPORT_STATUS.SUBMITTED });
            expect(await expectLockedFor('owner')).toEqual([200, 200, 200]);
        });

        it('property details: open before the start, refused after', async () => {
            expect((await patch(buildApp('staff'), { sqft: 2000 })).status).toBe(200);
            await setRow({ reportStatus: REPORT_STATUS.SUBMITTED });
            expect((await patch(buildApp('staff'), { sqft: 2400 })).status).toBe(403);
            expect((await readRow())?.sqft).toBe(2000);
        });
    });

    describe('payment and agreement requirements', () => {
        it('lets staff switch one on and refuses switching one off', async () => {
            expect((await patch(buildApp('staff'), { agreementRequired: true })).status).toBe(200);
            expect((await patch(buildApp('staff'), { paymentRequired: false })).status).toBe(403);
            const row = await readRow();
            expect([row?.agreementRequired, row?.paymentRequired]).toEqual([true, true]);
        });

        it('control: an owner switches a requirement off', async () => {
            expect((await patch(buildApp('owner'), { paymentRequired: false })).status).toBe(200);
            expect((await readRow())?.paymentRequired).toBe(false);
        });
    });

    describe('scheduleOthers', () => {
        it('refuses an order field on a job staff do not work when scheduleOthers is off', async () => {
            expect((await patch(buildApp('staff', { scheduleOthers: false }), { referenceNumber: 'R-3' })).status).toBe(403);
            expect((await readRow())?.referenceNumber).toBeNull();
        });

        it('control: staff named on the job write it with scheduleOthers off; with it on they do not need to be', async () => {
            expect((await patch(buildApp('staff'), { referenceNumber: 'R-4' })).status).toBe(200);
            await setRow({ inspectorId: ACTOR, referenceNumber: null });
            expect((await patch(buildApp('staff', { scheduleOthers: false }), { referenceNumber: 'R-6' })).status).toBe(200);
            expect((await readRow())?.referenceNumber).toBe('R-6');
        });
    });
});
