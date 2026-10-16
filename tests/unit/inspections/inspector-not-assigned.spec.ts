/**
 * What the server does when an INSPECTOR who is not on a job (not its lead, not a helper,
 * no scheduleOthers) uses the controls the hub shows. Real routes, real status service;
 * one case per control, with the inspector who IS on the job and the owner as controls.
 *
 * "Refused" is a 403; anything else means the request got past the guards (the status is
 * whatever the handler then answered). The table at the bottom is what the hub may rely
 * on: the page hides a control from a viewer who may not act on the job only where this
 * says the server refuses it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';
// eslint-disable-next-line import/order
import invoiceRoutes from '../../../server/api/invoices';

const T = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const LEAD = '00000000-0000-0000-0000-0000000000a1';
const OTHER = '00000000-0000-0000-0000-0000000000b2';
const JOB = 'job-1';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const EXEC = makeExecutionContext().ctx;

let db: BetterSQLite3Database<typeof schema>;

type Actor = 'owner' | 'on-the-job inspector' | 'helper on the roster' | 'inspector with scheduleOthers' | 'inspector not on the job' | 'manager with scheduleOthers off';
const ACTORS: Actor[] = ['owner', 'on-the-job inspector', 'helper on the roster', 'inspector with scheduleOthers', 'inspector not on the job', 'manager with scheduleOthers off'];
/** The actors that must be refused every act on a job they are not on. */
const NOT_ALLOWED: Actor[] = ['inspector not on the job', 'manager with scheduleOthers off'];

function buildApp(actor: Actor) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const role: UserRole = actor === 'owner' ? 'owner' : actor === 'manager with scheduleOthers off' ? 'manager' : 'inspector';
    const overrides = actor === 'inspector with scheduleOthers' ? { scheduleOthers: true } : actor === 'manager with scheduleOthers off' ? { scheduleOthers: false } : null;
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    const sdb = new ScopedDB(db as never, T);
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: ACTOR, role, tenantId: T });
        // An inspector's defaults: scheduleOthers off. The override cases switch it on (inspector) or off (manager).
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: new InspectionService({} as D1Database, undefined, sdb),
            people: { getPrimaryClient: async () => null },
            invoice: { findByInspectionId: async () => null },
            portalAccess: { setExpiryForInspection: async () => undefined },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.route('/api/invoices', invoiceRoutes);
    return app;
}

interface Control { name: string; method: string; path: string; body?: unknown; state?: Partial<typeof schema.inspections.$inferInsert> }

const CONTROLS: Control[] = [
    { name: 'PATCH date', method: 'PATCH', path: `/api/inspections/${JOB}`, body: { date: '2026-06-09' } },
    { name: 'PATCH inspector', method: 'PATCH', path: `/api/inspections/${JOB}`, body: { inspectorId: OTHER } },
    { name: 'PATCH address (order field)', method: 'PATCH', path: `/api/inspections/${JOB}`, body: { propertyAddress: '99 Elm Street' } },
    { name: 'PATCH /schedule', method: 'PATCH', path: `/api/inspections/${JOB}/schedule`, body: { scheduledStartMs: Date.UTC(2026, 5, 1, 9) } },
    { name: 'cancel', method: 'POST', path: `/api/inspections/${JOB}/cancel`, body: { reason: 'client_cancelled' } },
    { name: 'uncancel', method: 'POST', path: `/api/inspections/${JOB}/uncancel`, state: { status: 'cancelled', cancelReason: 'client_cancelled' } },
    { name: 'confirm', method: 'POST', path: `/api/inspections/${JOB}/confirm` },
    { name: 'complete', method: 'POST', path: `/api/inspections/${JOB}/complete` },
    { name: 'publish', method: 'POST', path: `/api/inspections/${JOB}/publish`, body: {} },
    { name: 'unpublish', method: 'POST', path: `/api/inspections/${JOB}/unpublish`, state: { reportStatus: 'published' } },
    { name: 'return', method: 'POST', path: `/api/inspections/${JOB}/return`, state: { reportStatus: 'submitted' } },
    { name: 'request-payment', method: 'POST', path: '/api/invoices/request-payment', body: { inspectionId: JOB } },
    { name: 'send-agreement', method: 'POST', path: `/api/inspections/${JOB}/agreement-requests`, body: {} },
];

/**
 * True where the server refuses someone who is neither on the job nor holds scheduleOthers (an inspector, or a manager
 * whose scheduleOthers was switched off). Acting on a job one is not on is decided by scheduleOthers. The one verb left
 * open is a PATCH of an order field other than date and inspector (the address here): it is not an act on the job's
 * lifecycle, and it stays as it was.
 */
const REFUSED_FOR_NOT_ON_JOB: Record<string, boolean> = {
    'PATCH date': true,
    'PATCH inspector': true,
    'PATCH address (order field)': false,
    'PATCH /schedule': true,
    cancel: true,
    uncancel: true,
    confirm: true,
    complete: true,
    publish: true,
    unpublish: true,
    return: true,
    'request-payment': true,
    'send-agreement': true,
};

/** Even someone on the job needs scheduleOthers to change WHO works it. */
const REFUSED_FOR_ON_THE_JOB = new Set(['PATCH inspector']);

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const now = new Date();
    await db.insert(schema.tenants).values({ id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    await db.insert(schema.users).values([
        { id: ACTOR, tenantId: T, email: 'actor@example.com', passwordHash: 'h', createdAt: now },
        { id: LEAD, tenantId: T, email: 'lead@example.com', passwordHash: 'h', createdAt: now },
        { id: OTHER, tenantId: T, email: 'other@example.com', passwordHash: 'h', createdAt: now },
    ]);
    await db.insert(schema.tenantConfigs).values({ tenantId: T, defaultTimezone: 'UTC', updatedAt: now });
});

async function statusOf(control: Control, actor: Actor): Promise<number> {
    await db.insert(schema.inspections).values({
        id: JOB, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId: actor === 'on-the-job inspector' ? ACTOR : LEAD,
        status: 'scheduled', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 0, createdAt: new Date(), ...control.state,
    });
    if (actor === 'helper on the roster') {
        await db.insert(schema.inspectionInspectors).values({ inspectionId: JOB, userId: ACTOR, tenantId: T, role: 'helper', createdAt: new Date() });
    }
    const res = await buildApp(actor).request(control.path, {
        method: control.method, headers: { 'Content-Type': 'application/json' },
        ...(control.body === undefined ? {} : { body: JSON.stringify(control.body) }),
    }, ENV, EXEC);
    return res.status;
}

describe('acting on a job one is not on is decided by scheduleOthers', () => {
    it('covers every control exactly once in the table', () => {
        expect(Object.keys(REFUSED_FOR_NOT_ON_JOB).sort()).toEqual(CONTROLS.map((c) => c.name).sort());
    });

    describe.each(CONTROLS)('$name', (control) => {
        it.each(NOT_ALLOWED)('is refused or allowed as the table says for: %s', async (actor) => {
            const status = await statusOf(control, actor);
            expect(status === 403, `${actor} got ${status}`).toBe(REFUSED_FOR_NOT_ON_JOB[control.name]);
        });

        it.each(ACTORS.filter((a) => !NOT_ALLOWED.includes(a)))('POSITIVE CONTROL - %s is refused only where the table says', async (actor) => {
            await db.delete(schema.inspectionInspectors);
            await db.delete(schema.inspections).where(eq(schema.inspections.id, JOB));
            const status = await statusOf(control, actor);
            const needsScheduleOthers = control.name === 'PATCH inspector' && (actor === 'on-the-job inspector' || actor === 'helper on the roster');
            expect(status === 403, `${actor} got ${status}`).toBe(needsScheduleOthers);
        });
    });

    it('the refusal says what to do', async () => {
        await db.insert(schema.inspections).values({
            id: JOB, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId: LEAD,
            status: 'scheduled', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        const res = await buildApp('inspector not on the job').request(`/api/inspections/${JOB}/cancel`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'client_cancelled' }),
        }, ENV, EXEC);
        expect(res.status).toBe(403);
        const message = ((await res.json()) as { error: { message: string } }).error.message;
        expect(message).toMatch(/not on this inspection/);
        expect(message).toMatch(/owner or manager/);
        expect(message).toMatch(/schedule others/);
    });

    it('an id that is not an inspection of this company is a 404 for the same caller (not a 403 about a job that is not there)', async () => {
        const res = await buildApp('inspector not on the job').request('/api/inspections/no-such-job/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'client_cancelled' }),
        }, ENV, EXEC);
        expect(res.status).toBe(404);
        // Control: the same caller on a job that exists is refused with 403.
        await db.insert(schema.inspections).values({
            id: JOB, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId: LEAD,
            status: 'scheduled', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        });
        const existing = await buildApp('inspector not on the job').request(`/api/inspections/${JOB}/cancel`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'client_cancelled' }),
        }, ENV, EXEC);
        expect(existing.status).toBe(403);
    });
});
