import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { InspectionService } from '../../../server/services/inspection.service';
import bulkRoutes from '../../../server/api/inspections/bulk';
import { AppError } from '../../../server/lib/errors';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, VISIBLE_TO_A, ALL_OF_TENANT } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('set reads honour the scope (service level)', () => {
    let svc: InspectionService;
    beforeEach(async () => {
        const f = createTestDb(); await setupSchema(f.sqlite); await seedVisibilityFixture(f.db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(f.db));
        svc = new InspectionService({} as D1Database, undefined, new ScopedDB(asScopedDbSource(f.db), TENANT));
    });
    const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };

    it('list: a restricted inspector sees exactly their assignments', async () => {
        const r = await svc.listInspections(TENANT, { limit: 50 }, A);
        expect(r.inspections.map(i => i.id).sort()).toEqual([...VISIBLE_TO_A].sort());
    });
    it('list: the all-scope sees the whole company (positive control)', async () => {
        const r = await svc.listInspections(TENANT, { limit: 50 }, ALL_INSPECTIONS);
        expect(r.inspections.map(i => i.id).sort()).toEqual([...ALL_OF_TENANT].sort());
    });
    it('list: a filter cannot widen the scope', async () => {
        // i-other and i-team both carry inspector_id = inspB; only i-team is on inspA's roster.
        const r = await svc.listInspections(TENANT, { limit: 50, inspectorId: USERS.inspB }, A);
        expect(r.inspections.map(i => i.id)).toEqual(['i-team']);
        // control: the unrestricted view of the same filter has both
        const all = await svc.listInspections(TENANT, { limit: 50, inspectorId: USERS.inspB }, ALL_INSPECTIONS);
        expect(all.inspections.map(i => i.id).sort()).toEqual(['i-other', 'i-team']);
    });
    it('list: search cannot reach an address outside the scope', async () => {
        const r = await svc.listInspections(TENANT, { limit: 50, search: 'i-other' }, A);
        expect(r.inspections).toEqual([]);
        const own = await svc.listInspections(TENANT, { limit: 50, search: 'i-own' }, A);
        expect(own.inspections.map(i => i.id)).toEqual(['i-own']);
    });
    it('list: tab filters are intersected with the scope, not substituted for it', async () => {
        for (const tab of ['today', 'upcoming', 'past', 'needs_confirmation', 'awaiting_report']) {
            const r = await svc.listInspections(TENANT, { limit: 50, tab } as never, A);
            for (const i of r.inspections) expect(VISIBLE_TO_A).toContain(i.id);
        }
        const today = await svc.listInspections(TENANT, { limit: 50, tab: 'today' } as never, A);
        expect(today.inspections.length).toBeGreaterThan(0); // not vacuous
    });
    it('list: pagination does not leak past the scope', async () => {
        const first = await svc.listInspections(TENANT, { limit: 1 }, A);
        const seen = [...first.inspections.map(i => i.id)];
        let cursor = first.nextCursor;
        while (cursor) {
            const next = await svc.listInspections(TENANT, { limit: 1, cursor }, A);
            seen.push(...next.inspections.map(i => i.id));
            cursor = next.nextCursor;
        }
        expect(seen.sort()).toEqual([...VISIBLE_TO_A].sort());
    });
    it('counts, stats and the dashboard agree with the list', async () => {
        const list = await svc.listInspections(TENANT, { limit: 50 }, A);
        expect((await svc.getCounts(TENANT, A)).all).toBe(list.inspections.length);
        expect((await svc.getStats(TENANT, A)).total).toBe(list.inspections.length);
        const b = await svc.getDashboardBuckets(TENANT, A);
        const inDash = new Set([...b.needsAttention, ...b.today, ...b.thisWeek, ...b.later, ...b.recentReports, ...b.cancelled].map(r => r.id as string));
        for (const id of inDash) expect(VISIBLE_TO_A).toContain(id);
        expect(inDash.size).toBeGreaterThan(0); // not vacuous
    });
    it('counts for the all-scope equal the whole company (positive control)', async () => {
        expect((await svc.getCounts(TENANT, ALL_INSPECTIONS)).all).toBe(ALL_OF_TENANT.length);
        expect((await svc.getStats(TENANT, ALL_INSPECTIONS)).total).toBe(ALL_OF_TENANT.length);
    });
    it('an inspector assigned to nothing gets empty reads', async () => {
        const C: InspectionScope = { kind: 'assigned', userId: USERS.inspC };
        expect((await svc.listInspections(TENANT, { limit: 50 }, C)).inspections).toEqual([]);
        expect((await svc.getCounts(TENANT, C)).all).toBe(0);
        expect((await svc.getStats(TENANT, C)).total).toBe(0);
        const b = await svc.getDashboardBuckets(TENANT, C);
        expect([...b.needsAttention, ...b.today, ...b.thisWeek, ...b.later, ...b.recentReports, ...b.cancelled]).toEqual([]);
    });
});

describe('set reads honour the scope (route level)', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
    });

    function build(userId: string, role: 'owner' | 'manager' | 'inspector') {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            const sdb = new ScopedDB(asScopedDbSource(db), TENANT);
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', sdb);
            c.set('services', {
                inspection: new InspectionService({} as D1Database, undefined, sdb),
                concierge: { listAwaitingInspector: async () => ({ count: 0 }) },
            } as never);
            await next();
        });
        app.route('/api/inspections', bulkRoutes as never);
        return app;
    }
    const get = async (userId: string, role: 'owner' | 'manager' | 'inspector', path: string) => {
        const res = await build(userId, role).request(path, {}, { DB: {} });
        return { status: res.status, body: await res.json() as { data: unknown; meta?: { counts?: { total: number } } } };
    };
    const ids = (rows: unknown) => (rows as Array<{ id: string }>).map(r => r.id).sort();

    it('GET /api/inspections: the restricted inspector sees the assigned set; owner, manager and an unrestricted inspector see all', async () => {
        expect(ids((await get(USERS.inspA, 'inspector', '/api/inspections?limit=50')).body.data)).toEqual([...VISIBLE_TO_A].sort());
        for (const [u, r] of [[USERS.owner, 'owner'], [USERS.manager, 'manager'], [USERS.inspAll, 'inspector']] as const) {
            expect(ids((await get(u, r, '/api/inspections?limit=50')).body.data)).toEqual([...ALL_OF_TENANT].sort());
        }
    });
    it('GET /api/inspections: the first-page stats use the same scope as the rows', async () => {
        const r = await get(USERS.inspA, 'inspector', '/api/inspections?limit=50');
        expect(r.body.meta?.counts?.total).toBe(VISIBLE_TO_A.length);
    });
    it('GET /api/inspections/counts: the restricted count equals the restricted list', async () => {
        const counts = await get(USERS.inspA, 'inspector', '/api/inspections/counts');
        expect((counts.body.data as { all: number }).all).toBe(VISIBLE_TO_A.length);
        const manager = await get(USERS.manager, 'manager', '/api/inspections/counts');
        expect((manager.body.data as { all: number }).all).toBe(ALL_OF_TENANT.length);
    });
    it('GET /api/inspections/dashboard: every bucket row belongs to the visible set', async () => {
        const d = await get(USERS.inspA, 'inspector', '/api/inspections/dashboard');
        expect(d.status).toBe(200);
        const data = d.body.data as Record<string, unknown>;
        const rows = ['needsAttention', 'today', 'thisWeek', 'later', 'recentReports', 'cancelled'].flatMap(k => data[k] as Array<{ id: string }>);
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(VISIBLE_TO_A).toContain(r.id);
    });
    it('an inspector assigned to nothing: empty list, zero counts', async () => {
        expect((await get(USERS.inspC, 'inspector', '/api/inspections?limit=50')).body.data).toEqual([]);
        expect(((await get(USERS.inspC, 'inspector', '/api/inspections/counts')).body.data as { all: number }).all).toBe(0);
    });
});
