/**
 * PATCH /api/inspections/:id/schedule — the dispatch write.
 *
 * These are HTTP-level tests against `app.request`, not `createRoutesStub` and
 * not direct handler calls, because the thing most worth pinning here is a
 * MIDDLEWARE decision: the route is gated by `requireCapability('scheduleOthers')`
 * rather than by a role tier. A test that bypasses middleware would return 200
 * for every actor and prove nothing — so the assertions are status codes, and
 * the interesting one is that an INSPECTOR with `{scheduleOthers: true}` gets
 * the same 200 an owner does. A role check cannot produce that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';
import { INSPECTION_STATUS } from '../../../server/lib/status/inspection-status';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';
import { ReschedulePatchSchema } from '../../../server/lib/validations/schedule.schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000ff';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const LEAD_A = '00000000-0000-0000-0000-0000000000a1';
const LEAD_B = '00000000-0000-0000-0000-0000000000b2';
const HELPER = '00000000-0000-0000-0000-0000000000c3';
const INSP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_INSP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

// 2026-06-01 09:00Z. The tenant timezone is UTC in these fixtures, so the
// derived civil date is unambiguous and the assertions stay about scheduling,
// not about zone math (which reschedule-dual-write.spec.ts already covers).
const START_MS = Date.UTC(2026, 5, 1, 9, 0, 0);

type Overrides = Record<string, boolean> | null;

function buildApp(
    db: BetterSQLite3Database<typeof schema>,
    role: UserRole,
    overrides: Overrides = null,
) {
    (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();

    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: ACTOR, role, tenantId: TENANT });
        c.set('sdb', {
            getById: async () => ({ permissionOverrides: overrides }),
        } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {} as unknown as HonoConfig['Variables']['services']);
        await next();
    });

    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

function patch(
    app: ReturnType<typeof buildApp>,
    body: Record<string, unknown>,
    id: string = INSP_ID,
) {
    return app.request(`/api/inspections/${id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, FAKE_ENV);
}

async function seedInspection(
    db: BetterSQLite3Database<typeof schema>,
    overrides: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await db.insert(schema.inspections).values({
        id: INSP_ID,
        tenantId: TENANT,
        propertyAddress: '1 Main St',
        date: '2026-06-01',
        status: INSPECTION_STATUS.SCHEDULED,
        reportStatus: REPORT_STATUS.IN_PROGRESS,
        paymentStatus: 'unpaid',
        price: 0,
        paymentRequired: false,
        agreementRequired: false,
        createdAt: new Date(),
        ...overrides,
    });
}

async function readRow(db: BetterSQLite3Database<typeof schema>, id = INSP_ID) {
    return db.select({
        date: schema.inspections.date,
        inspectorId: schema.inspections.inspectorId,
        scheduledStartMs: schema.inspections.scheduledStartMs,
        scheduledEndMs: schema.inspections.scheduledEndMs,
        durationMin: schema.inspections.durationMin,
    }).from(schema.inspections).where(eq(schema.inspections.id, id)).get();
}

async function readAssignments(db: BetterSQLite3Database<typeof schema>, id = INSP_ID) {
    return db.select({
        userId: schema.inspectionInspectors.userId,
        role: schema.inspectionInspectors.role,
    })
        .from(schema.inspectionInspectors)
        .where(and(
            eq(schema.inspectionInspectors.inspectionId, id),
            eq(schema.inspectionInspectors.tenantId, TENANT),
        ))
        .all();
}

describe('PATCH /api/inspections/:id/schedule', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, name: 'Rival', slug: 'rival', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await db.insert(schema.users).values([
            { id: ACTOR, tenantId: TENANT, email: 'actor@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: LEAD_A, tenantId: TENANT, email: 'a@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: LEAD_B, tenantId: TENANT, email: 'b@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: HELPER, tenantId: TENANT, email: 'c@example.com', passwordHash: 'h', createdAt: new Date() },
        ]);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            defaultTimezone: 'UTC',
            updatedAt: new Date(),
        });
    });

    // ── the capability gate ──────────────────────────────────────────────────

    it('owner → 200', async () => {
        await seedInspection(db);
        const res = await patch(buildApp(db, 'owner'), { scheduledStartMs: START_MS });
        expect(res.status).toBe(200);
    });

    it('inspector with no override → 403 (scheduleOthers is false by role default)', async () => {
        await seedInspection(db);
        const res = await patch(buildApp(db, 'inspector'), { scheduledStartMs: START_MS });
        expect(res.status).toBe(403);
        const body = await res.json() as { error?: { message?: string } };
        expect(body.error?.message).toContain('scheduleOthers');
    });

    it('inspector WITH the scheduleOthers override → 200', async () => {
        // The whole point of gating on a capability rather than a role tier:
        // this actor's ROLE is unchanged and still fails an isAdminRole test,
        // yet the toggle grants the action. If the route ever regresses to a
        // role check, this is the case that goes red.
        await seedInspection(db);
        const res = await patch(buildApp(db, 'inspector', { scheduleOthers: true }), { scheduledStartMs: START_MS });
        expect(res.status).toBe(200);
    });

    it('agent → 403 (outside the role gate entirely)', async () => {
        await seedInspection(db);
        const res = await patch(buildApp(db, 'agent'), { scheduledStartMs: START_MS });
        expect(res.status).toBe(403);
    });

    // ── the write ────────────────────────────────────────────────────────────

    it('writes the instant, derives the civil date, and moves the end with it', async () => {
        await seedInspection(db, {
            date: '2026-05-20',
            scheduledStartMs: new Date(Date.UTC(2026, 4, 20, 14, 0, 0)),
            scheduledEndMs: new Date(Date.UTC(2026, 4, 20, 17, 0, 0)),
        });
        const res = await patch(buildApp(db, 'owner'), { scheduledStartMs: START_MS });
        expect(res.status).toBe(200);

        const row = await readRow(db);
        expect(row?.date).toBe('2026-06-01');
        expect(row?.scheduledStartMs?.getTime()).toBe(START_MS);
        // 3h span preserved, not recomputed from a default.
        expect(row?.scheduledEndMs?.getTime()).toBe(START_MS + 180 * 60_000);
    });

    it('reassigns the lead and clears the legacy inspector column on unassign', async () => {
        await seedInspection(db, { inspectorId: LEAD_A });
        const app = buildApp(db, 'owner');

        expect((await patch(app, { scheduledStartMs: START_MS, leadInspectorId: LEAD_B })).status).toBe(200);
        expect(await readAssignments(db)).toEqual([{ userId: LEAD_B, role: 'lead' }]);
        expect((await readRow(db))?.inspectorId).toBe(LEAD_B);

        expect((await patch(app, { scheduledStartMs: START_MS, leadInspectorId: null })).status).toBe(200);
        expect(await readAssignments(db)).toEqual([]);
        // The link table is authoritative, but `inspections.inspector_id` is the
        // fallback readers use when it is empty — leaving it set would put the
        // card back on the old inspector's column right after it was dragged off.
        expect((await readRow(db))?.inspectorId).toBeNull();
    });

    it('keeps the helpers when only the lead is sent', async () => {
        await seedInspection(db);
        // Adverse order on purpose: the helper row is inserted BEFORE the lead
        // row, so a roster read that happened to trust insertion order would
        // pick the wrong person and this would fail rather than pass by luck.
        await db.insert(schema.inspectionInspectors).values([
            { inspectionId: INSP_ID, userId: HELPER, tenantId: TENANT, role: 'helper', createdAt: new Date() },
            { inspectionId: INSP_ID, userId: LEAD_A, tenantId: TENANT, role: 'lead', createdAt: new Date() },
        ]);

        const res = await patch(buildApp(db, 'owner'), { scheduledStartMs: START_MS, leadInspectorId: LEAD_B });
        expect(res.status).toBe(200);

        const rows = await readAssignments(db);
        expect(rows.find((r) => r.role === 'lead')?.userId).toBe(LEAD_B);
        expect(rows.filter((r) => r.role === 'helper').map((r) => r.userId)).toEqual([HELPER]);
    });

    it('rejects an assignee from another tenant with 400', async () => {
        await seedInspection(db);
        await db.insert(schema.users).values({
            id: '00000000-0000-0000-0000-0000000000d4',
            tenantId: OTHER_TENANT,
            email: 'foreign@example.com',
            passwordHash: 'h',
            createdAt: new Date(),
        });
        const res = await patch(buildApp(db, 'owner'), {
            scheduledStartMs: START_MS,
            leadInspectorId: '00000000-0000-0000-0000-0000000000d4',
        });
        expect(res.status).toBe(400);
    });

    it('404s an inspection belonging to another tenant', async () => {
        await db.insert(schema.inspections).values({
            id: OTHER_INSP,
            tenantId: OTHER_TENANT,
            propertyAddress: '9 Rival Rd',
            date: '2026-06-01',
            status: INSPECTION_STATUS.SCHEDULED,
            reportStatus: REPORT_STATUS.IN_PROGRESS,
            paymentStatus: 'unpaid',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt: new Date(),
        });
        const res = await patch(buildApp(db, 'owner'), { scheduledStartMs: START_MS }, OTHER_INSP);
        expect(res.status).toBe(404);
        expect((await readRow(db, OTHER_INSP))?.date).toBe('2026-06-01');
    });

    // ── booking_conflict_policy ──────────────────────────────────────────────

    async function seedOverlap() {
        await db.insert(schema.inspections).values({
            id: OTHER_INSP,
            tenantId: TENANT,
            propertyAddress: '2 Other St',
            date: '2026-06-01',
            status: INSPECTION_STATUS.SCHEDULED,
            reportStatus: REPORT_STATUS.IN_PROGRESS,
            paymentStatus: 'unpaid',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt: new Date(),
            scheduledStartMs: new Date(START_MS),
            scheduledEndMs: new Date(START_MS + 60 * 60_000),
        });
        await db.insert(schema.inspectionInspectors).values({
            inspectionId: OTHER_INSP, userId: LEAD_A, tenantId: TENANT, role: 'lead', createdAt: new Date(),
        });
    }

    it('advisory policy → 200 and the overlap rides along in the payload', async () => {
        await seedInspection(db, { date: '2026-05-20' });
        await seedOverlap();
        const res = await patch(buildApp(db, 'owner'), {
            scheduledStartMs: START_MS, durationMin: 60, leadInspectorId: LEAD_A,
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { conflicts: Array<{ inspectionId: string; inspectorId: string }> } };
        expect(body.data.conflicts).toEqual([{
            inspectionId: OTHER_INSP,
            propertyAddress: '2 Other St',
            date: '2026-06-01',
            inspectorId: LEAD_A,
        }]);
        expect((await readRow(db))?.date).toBe('2026-06-01');
    });

    it('block policy → 409 and nothing is written', async () => {
        await db.update(schema.tenantConfigs)
            .set({ bookingConflictPolicy: 'block' })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        await seedInspection(db, { date: '2026-05-20' });
        await seedOverlap();

        const res = await patch(buildApp(db, 'owner'), {
            scheduledStartMs: START_MS, durationMin: 60, leadInspectorId: LEAD_A,
        });
        expect(res.status).toBe(409);
        const body = await res.json() as { error: { code: string; conflicts: unknown[] } };
        expect(body.error.code).toBe('SCHEDULE_CONFLICT');
        expect(body.error.conflicts).toHaveLength(1);

        const row = await readRow(db);
        expect(row?.date).toBe('2026-05-20');
        expect(row?.scheduledStartMs).toBeNull();
        expect(await readAssignments(db)).toEqual([]);
    });

    // ── the partial-write trap ───────────────────────────────────────────────

    it('leaves durationMin ABSENT when the caller omits it', () => {
        // zod `.default()` survives `.partial()`, so a schema that defaulted
        // durationMin would hand the handler a value the caller never sent and
        // the handler would dutifully write it over the booked duration. The
        // assertion is on the KEY, not on its value — a value assertion passes
        // against exactly the bug it is meant to catch.
        const parsed = ReschedulePatchSchema.parse({ scheduledStartMs: START_MS });
        expect('durationMin' in parsed).toBe(false);
        expect('leadInspectorId' in parsed).toBe(false);
        expect('helperInspectorIds' in parsed).toBe(false);
    });

    it('preserves the stored durationMin across a duration-less reschedule', async () => {
        await seedInspection(db, { date: '2026-05-20', durationMin: 240 });
        const res = await patch(buildApp(db, 'owner'), { scheduledStartMs: START_MS });
        expect(res.status).toBe(200);
        const row = await readRow(db);
        expect(row?.durationMin).toBe(240);
        expect(row?.scheduledEndMs?.getTime()).toBe(START_MS + 240 * 60_000);
    });
});
