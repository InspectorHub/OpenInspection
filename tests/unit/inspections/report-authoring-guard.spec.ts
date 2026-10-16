/**
 * `editReports` guards every route that writes report content.
 *
 * The guard is a path-scoped middleware registered once, ahead of the routers,
 * so a route cannot opt out of it by forgetting to wear it. These tests read the
 * REAL route table: each authoring route is rebuilt as a stub carrying the real
 * guard, so the verdict is the guard's and the stub is reached only when the
 * guard let the request through.
 *
 * The classification test is the one that matters over time. Every mutating
 * route under /api/inspections/:id/ must be either guarded or listed below as
 * deliberately not report content, so a new write route that nobody classified
 * turns this file red instead of silently staying open to a role that must not
 * write reports.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../server/index';
import {
    isReportAuthoringPath,
    reportAuthoringGuard,
    assertMayEditReports,
} from '../../../server/lib/inspection/report-authoring-guard';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';

type RouteEntry = { method: string; path: string; handler: unknown };
const routes = (): RouteEntry[] => (app as unknown as { routes: RouteEntry[] }).routes;

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

function mutatingRoutes(): RouteEntry[] {
    const seen = new Set<string>();
    return routes().filter((r) => {
        if (!WRITE.has(r.method) || seen.has(key(r))) return false;
        seen.add(key(r));
        return true;
    });
}

/** Everything under /api/inspections/:id|:inspectionId/ plus the offline package import. */
const inScope = (r: RouteEntry) => /^\/api\/inspections\/:(id|inspectionId)\//.test(r.path) || r.path === '/api/client/import';

/** Mutating routes that are NOT report content, each with the reason. */
const NOT_REPORT_CONTENT: Record<string, string> = {
    'DELETE /api/inspections/:id/documents/:docId': 'client document',
    'DELETE /api/inspections/:id/people/:personId': 'people on the job',
    'DELETE /api/inspections/:id/reports/:reportId': 'report lifecycle',
    'DELETE /api/inspections/:id/services/:lineId': 'booked service line',
    'PATCH /api/inspections/:id/pay-splits/:splitId': 'money',
    'PATCH /api/inspections/:id/schedule': 'scheduling',
    'PATCH /api/inspections/:id/services/:lineId': 'booked service line',
    'POST /api/inspections/:id/agent-token': 'sharing',
    'POST /api/inspections/:id/agreement-requests': 'agreements',
    'POST /api/inspections/:id/cancel': 'cancellation',
    'POST /api/inspections/:id/clone': 'creates another inspection',
    'POST /api/inspections/:id/complete': 'status',
    'POST /api/inspections/:id/confirm': 'status',
    'POST /api/inspections/:id/export/word': 'export of existing content',
    'POST /api/inspections/:id/pay-splits/:splitId/corrections': 'money',
    'POST /api/inspections/:id/pay-splits/refresh': 'money',
    'POST /api/inspections/:id/pdf/refresh': 'rendering of existing content',
    'POST /api/inspections/:id/people': 'people on the job',
    'POST /api/inspections/:id/people/:personId/make-primary': 'people on the job',
    'POST /api/inspections/:id/people/:personId/reset-access': 'people on the job',
    'POST /api/inspections/:id/publish': 'publishing is its own capability',
    'POST /api/inspections/:id/reinspect': 'creates another inspection',
    'POST /api/inspections/:id/relock-report': 'report lifecycle',
    'POST /api/inspections/:id/return': 'review workflow',
    'POST /api/inspections/:id/send-report-pdf': 'delivery',
    'POST /api/inspections/:id/send-sms': 'delivery',
    'POST /api/inspections/:id/services': 'booked service line',
    'POST /api/inspections/:id/share-agent': 'sharing',
    'POST /api/inspections/:id/sign': 'signing',
    'POST /api/inspections/:id/uncancel': 'cancellation',
    'POST /api/inspections/:id/unlock-report': 'report lifecycle',
    'POST /api/inspections/:id/unpublish': 'publishing is its own capability',
    'POST /api/inspections/:inspectionId/events': 'activity log',
    'POST /api/inspections/:inspectionId/messages': 'messaging',
    'POST /api/inspections/:inspectionId/messages/upload': 'messaging',
    'PUT /api/inspections/:id/documents': 'client document',
    'PUT /api/inspections/:id/report-link-expiry': 'delivery setting',
};

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'abc').replace(/\*/g, 'x');

function stubApp(role: Role, overrides: Record<string, boolean> | null, route: { method: string; path: string }) {
    const reads = { count: 0 };
    let reached = false;
    const a = new Hono<HonoConfig>();
    a.onError((err, c) => (err instanceof AppError
        ? c.json({ error: err.message }, err.status)
        : c.json({ error: String(err) }, 500)));
    a.use('*', async (c, next) => {
        c.set('tenantId', 't1');
        c.set('userRole', role);
        c.set('user', { sub: 'u1', role, tenantId: 't1' });
        c.set('sdb', {
            getById: async () => { reads.count += 1; return { permissionOverrides: overrides }; },
        } as unknown as HonoConfig['Variables']['sdb']);
        await next();
    });
    a.use('/api/inspections/*', reportAuthoringGuard);
    a.use('/api/client/*', reportAuthoringGuard);
    a.on(route.method, route.path, (c) => { reached = true; return c.json({ ok: true }); });
    const call = async (method = route.method) => {
        const res = await a.request(concrete(route.path), { method }, { DB: {} });
        return res.status;
    };
    return { call, reached: () => reached, reads };
}

describe('report authoring guard', { timeout: 30_000 }, () => {
    const authoring = mutatingRoutes().filter((r) => inScope(r) && isReportAuthoringPath(r.path));
    const unclassified = mutatingRoutes().filter(
        (r) => inScope(r) && !isReportAuthoringPath(r.path) && !(key(r) in NOT_REPORT_CONTENT),
    );

    it('prints both counts and refuses an empty scan', () => {
        // eslint-disable-next-line no-console
        console.log(`report-authoring: mutating-in-scope=${mutatingRoutes().filter(inScope).length} guarded=${authoring.length} listed-not-content=${Object.keys(NOT_REPORT_CONTENT).length}`);
        expect(authoring.length).toBeGreaterThan(30);
        expect(Object.keys(NOT_REPORT_CONTENT).length).toBeGreaterThan(30);
    });

    it('every mutating route in scope is either guarded or listed as not report content', () => {
        expect(unclassified.map(key)).toEqual([]);
    });

    it('lists no route that is gone or that the guard now covers (no stale entries)', () => {
        const present = new Set(mutatingRoutes().map(key));
        const stale = Object.keys(NOT_REPORT_CONTENT).filter((k) => !present.has(k) || isReportAuthoringPath(k.split(' ')[1] as string));
        expect(stale).toEqual([]);
    });

    it('the guard is registered ahead of every guarded route', () => {
        const all = routes();
        const guardAt = all.findIndex((r) => (r.handler as { reportAuthoringGuard?: boolean }).reportAuthoringGuard === true);
        expect(guardAt).toBeGreaterThanOrEqual(0);
        const firstRouteAt = all.findIndex((r) => r.path.startsWith('/api/inspections') && r.handler !== undefined
            && (r.handler as { reportAuthoringGuard?: boolean }).reportAuthoringGuard !== true
            && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method));
        expect(guardAt).toBeLessThan(firstRouteAt);
    });

    describe.each(authoring.map((r) => [key(r), r] as const))('%s', (_label, route) => {
        it('refuses staff (editReports off by default) and never reaches the handler', async () => {
            const s = stubApp('staff', null, route);
            expect(await s.call()).toBe(403);
            expect(s.reached()).toBe(false);
        });

        it('admits an inspector (positive control) and a staff member who was granted it', async () => {
            const i = stubApp('inspector', null, route);
            expect(await i.call()).not.toBe(403);
            expect(i.reached()).toBe(true);
            const g = stubApp('staff', { editReports: true }, route);
            expect(await g.call()).not.toBe(403);
            expect(g.reached()).toBe(true);
        });

        it('refuses an inspector whose editReports was withdrawn', async () => {
            const s = stubApp('inspector', { editReports: false }, route);
            expect(await s.call()).toBe(403);
            expect(s.reached()).toBe(false);
        });

        it('admits the owner without reading overrides', async () => {
            const s = stubApp('owner', null, route);
            expect(await s.call()).not.toBe(403);
            expect(s.reads.count).toBe(0);
        });
    });

    it('does not touch reads of the same families: staff reach a GET on a guarded path', async () => {
        const route = authoring[0] as RouteEntry;
        const s = stubApp('staff', null, { method: 'GET', path: route.path });
        expect(await s.call()).toBe(200);
        expect(s.reached()).toBe(true);
        expect(s.reads.count).toBe(0);
    });

    it('does not read the database for a write that is not report content', async () => {
        const s = stubApp('staff', null, { method: 'POST', path: '/api/inspections/:id/publish' });
        expect(await s.call()).toBe(200);
        expect(s.reads.count).toBe(0);
    });

    describe('assertMayEditReports', () => {
        const ctx = (role: string, overrides: Record<string, boolean> | null) => ({
            get: (k: string) => ({
                userRole: role, tenantId: 't1', user: { sub: 'u1' },
                sdb: { getById: async () => ({ permissionOverrides: overrides }) },
            } as Record<string, unknown>)[k],
        }) as never;

        it('refuses staff, admits an inspector and a granted staff member', async () => {
            await expect(assertMayEditReports(ctx('staff', null))).rejects.toMatchObject({ status: 403 });
            await expect(assertMayEditReports(ctx('inspector', null))).resolves.toBeUndefined();
            await expect(assertMayEditReports(ctx('staff', { editReports: true }))).resolves.toBeUndefined();
        });

        it('refuses an agent even when an override says otherwise (pinned)', async () => {
            await expect(assertMayEditReports(ctx('agent', { editReports: true }))).rejects.toMatchObject({ status: 403 });
        });
    });
});
