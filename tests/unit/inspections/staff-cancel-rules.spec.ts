/**
 * Cancel, restore and confirm for office staff, through the real routes and the real
 * status service.
 *
 *  - Staff cancel only a job nothing has been collected on and the inspector has not
 *    started; a paid job is the owner's or manager's (it moves money).
 *  - A restore brings back the status the job had before it was cancelled, and never
 *    touches the report status, the agreement or the signing records.
 *  - Staff cannot reopen a completed job by confirming or restoring it.
 *  - Every move needs scheduleOthers or a place on the job.
 *
 * Every refusal is paired with the same request made by a role it does not apply to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { recordPayment } from '../../../server/services/payment-ledger.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const auditSpy = vi.fn();
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: (...args: unknown[]) => auditSpy(...args),
}));

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';
// eslint-disable-next-line import/order
import eventsRoutes from '../../../server/api/events';

const T = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const LEAD = '00000000-0000-0000-0000-0000000000a1';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const EXEC = makeExecutionContext().ctx;
const JOB = 'job-1';

let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    const sdb = new ScopedDB(db as never, T);
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: ACTOR, role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: new InspectionService({} as D1Database, undefined, sdb),
            event: { updateEventStatus: async () => undefined },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.route('/api', eventsRoutes);
    return app;
}

const post = (app: OpenAPIHono<HonoConfig>, path: string, body?: unknown) =>
    app.request(`/api/inspections/${JOB}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, ENV, EXEC);
const cancel = (app: OpenAPIHono<HonoConfig>) => post(app, '/cancel', { reason: 'client_cancelled' });

const readJob = () => db.select().from(schema.inspections).where(eq(schema.inspections.id, JOB)).get();
const setJob = (values: Partial<typeof schema.inspections.$inferInsert>) =>
    db.update(schema.inspections).set(values).where(eq(schema.inspections.id, JOB));

/** The cancel and restore rows the routes wrote, oldest first. */
const statusRows = async () => (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'inspection.status_change')).all())
    .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

beforeEach(async () => {
    auditSpy.mockClear();
    const fix = createTestDb();
    db = fix.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const now = new Date();
    await db.insert(schema.tenants).values({ id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    await db.insert(schema.users).values([
        { id: ACTOR, tenantId: T, email: 'actor@example.com', passwordHash: 'h', createdAt: now },
        { id: LEAD, tenantId: T, email: 'lead@example.com', passwordHash: 'h', createdAt: now },
    ]);
    await db.insert(schema.tenantConfigs).values({ tenantId: T, defaultTimezone: 'UTC', updatedAt: now });
    await db.insert(schema.inspections).values({
        id: JOB, tenantId: T, propertyAddress: '1 Main St', date: '2099-08-07', inspectorId: LEAD, status: 'scheduled',
        reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 45000, paymentRequired: false, agreementRequired: false, createdAt: now,
    });
});

describe('cancel', () => {
    it('lets staff cancel an unpaid job that has not started, and records the status it had', async () => {
        const res = await cancel(buildApp('staff'));
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await readJob())?.status).toBe('cancelled');
        // Written through the awaited helper, so it is in the table by the time the response returns.
        expect((await statusRows()).map((r) => r.metadata)).toEqual([expect.objectContaining({ from: 'scheduled', to: 'cancelled' })]);
    });

    it('refuses staff a job with money collected on it, however the money is recorded, and changes nothing', async () => {
        await setJob({ paymentStatus: 'paid' });
        expect((await cancel(buildApp('staff'))).status).toBe(403);
        expect((await readJob())?.status).toBe('scheduled');

        // The order flag says unpaid, but the ledger holds a card payment.
        await setJob({ paymentStatus: 'unpaid' });
        await db.insert(schema.invoices).values({
            id: 'inv-1', tenantId: T, inspectionId: JOB, amountCents: 45000,
            lineItems: [{ description: 'Inspection', amountCents: 45000 }], createdAt: new Date(),
        } as never);
        await recordPayment(db as never, T, {
            invoiceId: 'inv-1', inspectionId: JOB, kind: 'balance', amountCents: 45000, method: 'card', provider: 'stripe', providerRef: 'pi_1',
        });
        expect((await cancel(buildApp('staff'))).status).toBe(403);
        expect((await readJob())?.status).toBe('scheduled');
    });

    it('control: an owner and a manager cancel the same paid job', async () => {
        for (const role of ['owner', 'manager'] as const) {
            await setJob({ status: 'scheduled', paymentStatus: 'paid' });
            expect((await cancel(buildApp(role))).status, role).toBe(200);
            expect((await readJob())?.status, role).toBe('cancelled');
        }
    });

    it.each([
        ['its report was submitted', () => setJob({ reportStatus: 'submitted' })],
        ['its visit is completed', () => setJob({ status: 'completed' })],
        ['a results row holds a key', () => db.insert(schema.inspectionResults).values({
            id: 'res-1', tenantId: T, inspectionId: JOB, data: { item1: { rating: 'good' } }, lastSyncedAt: new Date(),
        })],
    ])('refuses staff once %s', async (_name, start) => {
        await start();
        const before = (await readJob())?.status;
        expect((await cancel(buildApp('staff'))).status).toBe(403);
        expect((await readJob())?.status).toBe(before);
    });

    it('control: an owner cancels a started job, and staff cancel one whose results row is empty', async () => {
        await setJob({ status: 'completed' });
        expect((await cancel(buildApp('owner'))).status).toBe(200);
        await setJob({ status: 'scheduled', cancelReason: null });
        await db.insert(schema.inspectionResults).values({ id: 'res-0', tenantId: T, inspectionId: JOB, data: {}, lastSyncedAt: new Date() });
        expect((await cancel(buildApp('staff'))).status).toBe(200);
    });

    it('needs scheduleOthers or a place on the job', async () => {
        expect((await cancel(buildApp('staff', { scheduleOthers: false }))).status).toBe(403);
        expect((await readJob())?.status).toBe('scheduled');
        await setJob({ inspectorId: ACTOR });
        expect((await cancel(buildApp('staff', { scheduleOthers: false }))).status).toBe(200);
    });
});

describe('cancelling twice', () => {
    it('is refused, and the first cancellation record is left as it was', async () => {
        expect((await cancel(buildApp('owner'))).status).toBe(200);
        const again = await cancel(buildApp('owner'));
        expect(again.status, await again.clone().text()).toBe(400);
        expect(await statusRows()).toHaveLength(1);
        expect((await readJob())?.status).toBe('cancelled');
    });

    it('POSITIVE CONTROL - after a restore the job can be cancelled again', async () => {
        expect((await cancel(buildApp('owner'))).status).toBe(200);
        expect((await post(buildApp('owner'), '/uncancel')).status).toBe(200);
        expect((await cancel(buildApp('owner'))).status).toBe(200);
    });
});

describe('restore', () => {
    async function ownerCancels(): Promise<void> {
        expect((await cancel(buildApp('owner'))).status).toBe(200);
    }

    it.each(['requested', 'scheduled', 'confirmed'] as const)('brings back a job that was %s when it was cancelled, for staff and for an owner', async (before) => {
        for (const role of ['staff', 'owner'] as const) {
            await db.delete(schema.auditLogs);
            await setJob({ status: before, cancelReason: null });
            await ownerCancels();
            expect((await readJob())?.status).toBe('cancelled');
            const res = await post(buildApp(role), '/uncancel');
            expect(res.status, `${role} ${await res.clone().text()}`).toBe(200);
            expect((await readJob())?.status, role).toBe(before);
        }
    });

    it('does not let staff restore a job that was completed when it was cancelled; an owner can, and it stays completed', async () => {
        await setJob({ status: 'completed', reportStatus: 'published' });
        await ownerCancels();
        expect((await post(buildApp('staff'), '/uncancel')).status).toBe(403);
        expect((await readJob())?.status).toBe('cancelled');

        const res = await post(buildApp('owner'), '/uncancel');
        expect(res.status).toBe(200);
        const row = await readJob();
        expect([row?.status, row?.reportStatus]).toEqual(['completed', 'published']);
        expect([row?.cancelReason, row?.cancelNotes]).toEqual([null, null]);
    });

    it('a cancellation with no record: an owner restores from what the row says, staff are refused', async () => {
        // A published report belongs to a finished visit; a confirmation stamp to a confirmed one; otherwise scheduled.
        const cases: Array<[Partial<typeof schema.inspections.$inferInsert>, string]> = [
            [{ reportStatus: 'published' }, 'completed'],
            [{ reportStatus: 'in_progress', confirmedAt: new Date(1_700_000_000_000) }, 'confirmed'],
            [{ reportStatus: 'in_progress', confirmedAt: null }, 'scheduled'],
        ];
        for (const [state, expected] of cases) {
            await setJob({ status: 'cancelled', cancelReason: 'client_cancelled', ...state });
            expect((await post(buildApp('staff'), '/uncancel')).status, expected).toBe(403);
            expect((await readJob())?.status).toBe('cancelled');
            expect((await post(buildApp('owner'), '/uncancel')).status, expected).toBe(200);
            expect((await readJob())?.status).toBe(expected);
        }
    });

    it('a job that was completed with its report still in progress is not restored by staff, and stays completed for an owner', async () => {
        await setJob({ status: 'completed', reportStatus: 'in_progress' });
        await ownerCancels();
        expect((await post(buildApp('staff'), '/uncancel')).status).toBe(403);
        expect((await post(buildApp('owner'), '/uncancel')).status).toBe(200);
        expect((await readJob())?.status).toBe('completed');
    });

    it('only the latest cancellation counts: a record from an earlier cancel and restore cycle is not reused', async () => {
        // Cycle 1: confirmed, cancelled, restored. Cycle 2: the job is completed, cancelled with its record lost.
        await setJob({ status: 'confirmed' });
        await ownerCancels();
        expect((await post(buildApp('owner'), '/uncancel')).status).toBe(200);
        expect((await readJob())?.status).toBe('confirmed');
        await setJob({ status: 'completed', reportStatus: 'published' });
        await ownerCancels();
        // Lose the second cancel's row only; the first cycle's rows stay.
        const rows = await statusRows();
        await db.delete(schema.auditLogs).where(eq(schema.auditLogs.id, rows[rows.length - 1]!.id));
        expect((await post(buildApp('staff'), '/uncancel')).status).toBe(403);
        expect((await post(buildApp('owner'), '/uncancel')).status).toBe(200);
        expect((await readJob())?.status, 'derived from the row, not the earlier cycle').toBe('completed');
    });

    it('ignores a recorded status of cancelled', async () => {
        await setJob({ status: 'cancelled', reportStatus: 'in_progress', confirmedAt: null });
        await db.insert(schema.auditLogs).values({
            id: 'a-bad', tenantId: T, userId: ACTOR, action: 'inspection.status_change', entityType: 'inspection', entityId: JOB,
            metadata: { from: 'cancelled', to: 'cancelled' }, createdAt: new Date(),
        } as typeof schema.auditLogs.$inferInsert);
        expect((await post(buildApp('owner'), '/uncancel')).status).toBe(200);
        expect((await readJob())?.status).toBe('scheduled');
    });

    it('needs scheduleOthers or a place on the job', async () => {
        await ownerCancels();
        expect((await post(buildApp('staff', { scheduleOthers: false }), '/uncancel')).status).toBe(403);
        expect((await readJob())?.status).toBe('cancelled');
        await setJob({ inspectorId: ACTOR });
        expect((await post(buildApp('staff', { scheduleOthers: false }), '/uncancel')).status).toBe(200);
    });

    it('cancel and restore leave the agreement and the signing records byte for byte as they were', async () => {
        const now = new Date(1_700_000_000_000);
        await db.insert(schema.agreements).values({ id: 'agr-1', tenantId: T, name: 'Agreement', content: '<p>x</p>', createdAt: now });
        await db.insert(schema.agreementRequests).values({
            id: 'req-1', tenantId: T, inspectionId: JOB, agreementId: 'agr-1', clientEmail: 'pat@example.com', status: 'signed',
            signedAt: now, contentSnapshot: '<p>x</p>', contentHash: 'abc', createdAt: now,
        } as typeof schema.agreementRequests.$inferInsert);
        await db.insert(schema.esignAuditLogs).values({
            id: 'esign-1', tenantId: T, requestId: 'req-1', event: 'agreement.signed', payloadJson: '{"a":1}',
            prevHash: null, hash: 'h1', signature: 's1', keyFingerprint: 'fp1', createdAt: now,
        });
        const snapshot = async () => JSON.stringify([
            await db.select().from(schema.agreementRequests).all(),
            await db.select().from(schema.esignAuditLogs).all(),
            (await readJob())?.reportStatus,
        ]);
        const before = await snapshot();

        expect((await cancel(buildApp('staff'))).status).toBe(200);
        expect((await post(buildApp('staff'), '/uncancel')).status).toBe(200);
        expect(await snapshot()).toBe(before);
        expect((await readJob())?.status).toBe('scheduled');
    });
});

describe('confirm', () => {
    it('lets staff confirm a booking', async () => {
        expect((await post(buildApp('staff'), '/confirm')).status).toBe(200);
        expect((await readJob())?.status).toBe('confirmed');
    });

    it('refuses staff a completed job, and an owner confirms it (the rule is staff only)', async () => {
        await setJob({ status: 'completed' });
        expect((await post(buildApp('staff'), '/confirm')).status).toBe(403);
        expect((await readJob())?.status).toBe('completed');
        expect((await post(buildApp('owner'), '/confirm')).status).toBe(200);
        expect((await readJob())?.status).toBe('confirmed');
    });

    it('needs scheduleOthers or a place on the job', async () => {
        expect((await post(buildApp('staff', { scheduleOthers: false }), '/confirm')).status).toBe(403);
        expect((await readJob())?.status).toBe('scheduled');
        await setJob({ inspectorId: ACTOR });
        expect((await post(buildApp('staff', { scheduleOthers: false }), '/confirm')).status).toBe(200);
    });
});

describe('visits', () => {
    it('staff still cannot cancel or complete a visit; an owner can', async () => {
        const put = (role: UserRole) => buildApp(role).request('/api/events/visit-1', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
        }, ENV, EXEC);
        expect((await put('staff')).status).toBe(403);
        expect((await put('owner')).status).toBe(200);
    });
});
