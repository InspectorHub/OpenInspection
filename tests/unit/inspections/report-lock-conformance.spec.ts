/**
 * A published report takes no content writes: 409 `REPORT_PUBLISHED`.
 *
 * CONFORMANCE, not a sample. The real route table is read, every mutating route under an inspection is classified,
 * and each one the guard covers is exercised against a real in-memory database in the three states a report has:
 *
 *   published  -> refused, handler never reached
 *   editing    -> reaches the handler (clients still see the last version; content may change again)
 *   draft      -> reaches the handler
 *
 * Every route that is NOT covered must be on the explicit allow-list (`report-write-classification.ts`, each with its
 * reason) and is shown to stay reachable on a published report, so an allow-list entry is a tested promise and not a
 * comment. A new write route that nobody classified turns this file red.
 *
 * The two writers that are not plain routes under `/api/inspections/:id/` are listed in `ENFORCED_ELSEWHERE`, each
 * with the spec that proves it: the offline package import (`tests/workers/native/report-published-lock.spec.ts`) and
 * the collaborative socket (`tests/workers/collab-report-lock.spec.ts`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { isReportAuthoringPath, reportAuthoringGuard } from '../../../server/lib/inspection/report-authoring-guard';
import { publishedReportLockGuard } from '../../../server/lib/inspection/report-lock-guard';
import { AppError } from '../../../server/lib/errors';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { NOT_REPORT_CONTENT } from '../helpers/report-write-classification';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { TestDb } from '../helpers/test-db';

type RouteEntry = { method: string; path: string; handler: unknown };
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

function mutatingRoutes(): RouteEntry[] {
    const seen = new Set<string>();
    return (app as unknown as { routes: RouteEntry[] }).routes.filter((r) => {
        if (!WRITE.has(r.method) || seen.has(key(r))) return false;
        seen.add(key(r));
        return true;
    });
}

const inScope = (r: RouteEntry) => /^\/api\/inspections\/:(id|inspectionId)\//.test(r.path) || r.path === '/api/client/import';
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'abc').replace(/\*/g, 'x');

/** Covered by the same route list as `editReports`, but enforced where the inspections are named in a body or a socket. */
const ENFORCED_ELSEWHERE: Record<string, string> = {
    'POST /api/client/import': 'the package names its inspections in the body; offline-import.service refuses the whole package (tests/workers/native/report-published-lock.spec.ts)',
};

const guarded = mutatingRoutes().filter((r) => inScope(r) && isReportAuthoringPath(r.path) && !(key(r) in ENFORCED_ELSEWHERE));
const allowListed = mutatingRoutes().filter((r) => inScope(r) && key(r) in NOT_REPORT_CONTENT);

describe('publish lock conformance', { timeout: 60_000 }, () => {
    let db: TestDb;
    let binding: D1Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        binding = toD1Binding(fixture.sqlite);
        await db.insert(schema.tenants).values({ id: 't1', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        // `concrete()` turns every path parameter into 'abc': the inspection AND, for the narrative route, the report.
        await db.insert(schema.inspections).values({
            id: 'abc', tenantId: 't1', propertyAddress: '1 Main', date: '2026-06-01', createdAt: new Date(),
        } as never);
        await db.insert(schema.reports).values({
            id: 'abc', tenantId: 't1', inspectionId: 'abc', kind: 'primary', title: 'Report', status: 'in_progress', createdAt: new Date(),
        });
    });

    /**
     * The three states of a report as the product writes them: publish sets the report AND the order, "Edit and republish"
     * moves only the report (the order stays published), and a retract resets both and clears `published_at`.
     */
    const setState = async (state: 'draft' | 'editing' | 'published') => {
        await db.update(schema.reports).set({
            status: state === 'published' ? 'published' : 'in_progress',
            publishedAt: state === 'draft' ? null : new Date(),
        }).where(eq(schema.reports.id, 'abc'));
        await db.update(schema.inspections).set({ reportStatus: state === 'draft' ? 'in_progress' : 'published' }).where(eq(schema.inspections.id, 'abc'));
    };

    function stub(route: { method: string; path: string }, withLock = true) {
        let reached = false;
        const a = new Hono<HonoConfig>();
        a.onError((err, c) => (err instanceof AppError
            ? c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status)
            : c.json({ error: String(err) }, 500)));
        a.use('*', async (c, next) => {
            c.set('tenantId', 't1');
            c.set('userRole', 'owner');
            c.set('user', { sub: 'u1', role: 'owner', tenantId: 't1' });
            await next();
        });
        a.use('/api/inspections/*', reportAuthoringGuard);
        a.use('/api/client/*', reportAuthoringGuard);
        if (withLock) a.use('/api/inspections/*', publishedReportLockGuard);
        a.on(route.method, route.path, (c) => { reached = true; return c.json({ ok: true }); });
        return {
            reached: () => reached,
            call: async (method = route.method) => {
                const res = await a.request(concrete(route.path), { method }, { DB: binding });
                return { status: res.status, body: await res.json() as { error?: { code?: string; message?: string; details?: { inspectionId?: string } } } };
            },
        };
    }

    it('prints its counts and refuses an empty scan', () => {
        // eslint-disable-next-line no-console
        console.log(`report-lock: guarded=${guarded.length} allow-listed=${allowListed.length} enforced-elsewhere=${Object.keys(ENFORCED_ELSEWHERE).length}`);
        expect(guarded.length).toBeGreaterThan(30);
        expect(allowListed.length).toBeGreaterThan(30);
    });

    it('classifies every mutating route in scope: guarded, enforced elsewhere, or on the allow-list', () => {
        const unclassified = mutatingRoutes().filter((r) => inScope(r)
            && !isReportAuthoringPath(r.path) && !(key(r) in NOT_REPORT_CONTENT));
        expect(unclassified.map(key)).toEqual([]);
    });

    it('every route "enforced elsewhere" still exists and is still in the guarded list (no stale entry)', () => {
        const present = new Set(mutatingRoutes().map(key));
        expect(Object.keys(ENFORCED_ELSEWHERE).filter((k) => !present.has(k) || !isReportAuthoringPath(k.split(' ')[1] as string))).toEqual([]);
    });

    it('the lock is registered on the real app, after the capability guard and ahead of every route it covers', () => {
        const all = (app as unknown as { routes: RouteEntry[] }).routes;
        const flag = (r: RouteEntry, name: string) => (r.handler as Record<string, unknown>)[name] === true;
        const capability = all.findIndex((r) => flag(r, 'reportAuthoringGuard'));
        const lock = all.findIndex((r) => flag(r, 'publishedReportLockGuard'));
        const firstWrite = all.findIndex((r) => r.path.startsWith('/api/inspections') && WRITE.has(r.method)
            && !flag(r, 'reportAuthoringGuard') && !flag(r, 'publishedReportLockGuard'));
        expect(lock, 'the publish lock is not registered on the app').toBeGreaterThanOrEqual(0);
        expect(lock).toBeGreaterThan(capability);
        expect(lock).toBeLessThan(firstWrite);
    });

    describe.each(guarded.map((r) => [key(r), r] as const))('%s', (_label, route) => {
        it('is refused on a PUBLISHED report with 409 REPORT_PUBLISHED, and never reaches the handler', async () => {
            await setState('published');
            const s = stub(route);
            const res = await s.call();
            expect(res.status).toBe(409);
            expect(res.body.error?.code).toBe('REPORT_PUBLISHED');
            expect(res.body.error?.message).toBe('Report is published. Update and republish?');
            expect(res.body.error?.details?.inspectionId).toBe('abc');
            expect(s.reached()).toBe(false);
        });

        it('reaches the handler while the report is being EDITED AGAIN (clients keep the last version) and while it is a draft', async () => {
            await setState('editing');
            const editing = stub(route);
            expect((await editing.call()).status).toBe(200);
            expect(editing.reached()).toBe(true);
            await setState('draft');
            const draft = stub(route);
            expect((await draft.call()).status).toBe(200);
            expect(draft.reached()).toBe(true);
        });

        it('still serves a READ of the same path on a published report', async () => {
            await setState('published');
            const s = stub({ method: 'GET', path: route.path });
            expect((await s.call()).status).toBe(200);
            expect(s.reached()).toBe(true);
        });

        it('(control) reaches the handler on a published report when the lock guard is not mounted', async () => {
            await setState('published');
            const s = stub(route, false);
            expect((await s.call()).status).toBe(200);
            expect(s.reached()).toBe(true);
        });
    });

    describe.each(allowListed.map((r) => [`${key(r)}  (${NOT_REPORT_CONTENT[key(r)]})`, r] as const))('allow-listed: %s', (_label, route) => {
        it('stays available on a PUBLISHED report', async () => {
            await setState('published');
            const s = stub(route);
            expect((await s.call()).status).toBe(200);
            expect(s.reached()).toBe(true);
        });
    });

    it('a report that is published is locked by its OWN row: a sibling deliverable does not lock the primary', async () => {
        await db.insert(schema.reports).values({
            id: 'radon', tenantId: 't1', inspectionId: 'abc', kind: 'ancillary', title: 'Radon', status: 'published', createdAt: new Date(), publishedAt: new Date(),
        });
        const route = guarded.find((r) => r.path === '/api/inspections/:id/inspector-signature') as RouteEntry;
        expect((await stub(route).call()).status).toBe(200);
        await setState('published');
        expect((await stub(route).call()).status).toBe(409);
    });

    it('a report RETRACTED before the order reset existed (report still published, order back in draft) is not locked', async () => {
        // What an older retract left behind: it reset only the order. There is no data migration, so the rule must tell.
        await db.update(schema.reports).set({ status: 'published', publishedAt: new Date() }).where(eq(schema.reports.id, 'abc'));
        await db.update(schema.inspections).set({ reportStatus: 'in_progress' }).where(eq(schema.inspections.id, 'abc'));
        const route = guarded.find((r) => r.path === '/api/inspections/:id/inspector-signature') as RouteEntry;
        const legacy = stub(route);
        expect((await legacy.call()).status).toBe(200);
        expect(legacy.reached()).toBe(true);
        // Control: the same report row with its order published IS locked.
        await db.update(schema.inspections).set({ reportStatus: 'published' }).where(eq(schema.inspections.id, 'abc'));
        expect((await stub(route).call()).status).toBe(409);
    });

    it('an inspection with no report row falls back to the order status', async () => {
        await db.delete(schema.reports).where(eq(schema.reports.id, 'abc'));
        const route = guarded.find((r) => r.path === '/api/inspections/:id/inspector-signature') as RouteEntry;
        expect((await stub(route).call()).status).toBe(200);
        await db.update(schema.inspections).set({ reportStatus: 'published' }).where(eq(schema.inspections.id, 'abc'));
        expect((await stub(route).call()).status).toBe(409);
    });
});
