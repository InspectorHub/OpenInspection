import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import { registerInspectionScopeGuards } from '../../../server/lib/middleware/inspection-scope';
import { app as realApp } from '../../../server/index';
import { seedVisibilityFixture, TENANT, USERS, INSP, VISIBLE_TO_A, HIDDEN_FROM_A } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

type R = { method: string; path: string; handler: { inspectionScopeGuard?: boolean } };

/** Every method+path the real app routes under an inspection id, so a route added later joins the matrix by itself. */
const STUB_ROUTES = (realApp as unknown as { routes: R[] }).routes
    .filter(r => /^\/api\/inspections\/:[^/]+/.test(r.path) && !r.handler?.inspectionScopeGuard && r.method !== 'ALL' && !r.path.includes('*'))
    .map(r => ({ method: r.method, path: r.path }));
const UNIQUE_ROUTES = [...new Map(STUB_ROUTES.map(r => [`${r.method} ${r.path}`, r])).values()];

const concrete = (path: string, id: string) => {
    let first = true;
    return path.replace(/:[A-Za-z]+/g, () => { if (first) { first = false; return id; } return 'p1'; });
};

type Persona = { userId: string; role: 'owner' | 'manager' | 'inspector' | 'staff' | 'agent' };
const PERSONAS: Record<string, Persona> = {
    inspA: { userId: USERS.inspA, role: 'inspector' },
    inspC: { userId: USERS.inspC, role: 'inspector' },
    inspAll: { userId: USERS.inspAll, role: 'inspector' },
    manager: { userId: USERS.manager, role: 'manager' },
    owner: { userId: USERS.owner, role: 'owner' },
    staff: { userId: 'u-staff', role: 'staff' },
};

describe('inspection path guard: visibility', { timeout: 60_000 }, () => {
    let db: ReturnType<typeof createTestDb>['db'];
    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
    });

    function buildApp(persona: Persona | null, reached: { n: number }) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            if (persona) {
                c.set('userRole', persona.role);
                c.set('user', { sub: persona.userId, role: persona.role, tenantId: TENANT } as never);
                c.set('tenantId', TENANT);
                c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            }
            await next();
        });
        registerInspectionScopeGuards(app);
        for (const r of UNIQUE_ROUTES) {
            app.on(r.method, r.path, (c) => { reached.n++; return c.json({ reached: true }); });
        }
        return app;
    }

    const call = async (persona: Persona | null, route: { method: string; path: string }, id: string) => {
        const reached = { n: 0 };
        const res = await buildApp(persona, reached).request(concrete(route.path, id), { method: route.method }, { DB: {} });
        return { status: res.status, body: await res.json().catch(() => null), reached: reached.n };
    };

    it('walks a real, large route table (a vacuous walk must fail)', () => {
        // eslint-disable-next-line no-console
        console.log(`[gate] guard matrix routes=${UNIQUE_ROUTES.length}`);
        expect(UNIQUE_ROUTES.length).toBeGreaterThan(50);
    });

    it('a restricted inspector gets 404 and never reaches the handler for a hidden inspection, on every route', async () => {
        const leaks: string[] = [];
        for (const id of HIDDEN_FROM_A) for (const route of UNIQUE_ROUTES) {
            const r = await call(PERSONAS.inspA!, route, id);
            if (r.status !== 404 || r.reached !== 0) leaks.push(`${route.method} ${route.path} ${id} -> ${r.status} reached=${r.reached}`);
        }
        expect(leaks, leaks.slice(0, 10).join('\n')).toEqual([]);
    });

    it('control: the same routes reach the handler for the inspections the inspector is assigned to', async () => {
        const blocked: string[] = [];
        for (const id of VISIBLE_TO_A) for (const route of UNIQUE_ROUTES) {
            const r = await call(PERSONAS.inspA!, route, id);
            if (r.status !== 200 || r.reached !== 1) blocked.push(`${route.method} ${route.path} ${id} -> ${r.status}`);
        }
        expect(blocked, blocked.slice(0, 10).join('\n')).toEqual([]);
    });

    it('an unrestricted inspector, a manager, an owner and office staff reach every inspection', async () => {
        for (const who of ['inspAll', 'manager', 'owner', 'staff'] as const) {
            for (const id of [INSP.other, INSP.unassigned, INSP.own]) {
                const r = await call(PERSONAS[who]!, UNIQUE_ROUTES[0]!, id);
                expect(r.status, `${who} ${id}`).toBe(200);
                expect(r.reached).toBe(1);
            }
        }
    });

    it('an inspector assigned to nothing sees nothing', async () => {
        for (const id of [INSP.own, INSP.team, INSP.unassigned]) {
            expect((await call(PERSONAS.inspC!, UNIQUE_ROUTES[0]!, id)).status).toBe(404);
        }
    });

    it('hidden, absent and another company answer the same 404, byte for byte', async () => {
        const route = UNIQUE_ROUTES[0]!;
        const hidden = await call(PERSONAS.inspA!, route, INSP.other);
        const unassigned = await call(PERSONAS.inspA!, route, INSP.unassigned);
        const absent = await call(PERSONAS.inspA!, route, 'no-such-id');
        const foreign = await call(PERSONAS.inspA!, route, INSP.foreign);
        for (const r of [hidden, unassigned, absent, foreign]) expect(r.status).toBe(404);
        expect(hidden.body).toEqual({ success: false, error: { code: 'not_found', message: 'Inspection not found' } });
        expect(unassigned.body).toEqual(hidden.body);
        expect(absent.body).toEqual(hidden.body);
        expect(foreign.body).toEqual(hidden.body);
    });

    it('a reserved static segment is a route, not an id: it reaches the handler and costs no inspection lookup', async () => {
        const reached = { n: 0 };
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'inspector'); c.set('user', { sub: USERS.inspA, role: 'inspector', tenantId: TENANT } as never);
            c.set('tenantId', TENANT); c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            await next();
        });
        registerInspectionScopeGuards(app);
        app.get('/api/inspections/templates', (c) => { reached.n++; return c.json({ ok: true }); });
        vi.mocked(drizzle).mockClear();
        const res = await app.request('/api/inspections/templates', {}, { DB: {} });
        expect(res.status).toBe(200);
        expect(reached.n).toBe(1);
        expect(vi.mocked(drizzle)).not.toHaveBeenCalled();
    });

    it('an agent is refused with 403 and anonymous with 401, before any lookup', async () => {
        expect((await call({ userId: 'u-agent', role: 'agent' }, UNIQUE_ROUTES[0]!, INSP.own)).status).toBe(403);
        expect((await call(null, UNIQUE_ROUTES[0]!, INSP.own)).status).toBe(401);
    });

    it('the published report video clip stays reachable with no session (the one anonymous route in this family)', async () => {
        const reached = { n: 0 };
        const a = new OpenAPIHono<HonoConfig>();
        a.onError((err, c) => err instanceof AppError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500));
        registerInspectionScopeGuards(a);
        a.get('/api/inspections/:id/media/video/r2-object/:poolRowId', (c) => { reached.n++; return c.json({ ok: true }); });
        a.get('/api/inspections/:id/media/video/other', (c) => c.json({ ok: true }));
        expect((await a.request('/api/inspections/i1/media/video/r2-object/row1', {}, { DB: {} })).status).toBe(200);
        expect(reached.n).toBe(1);
        // control: a neighbouring path with no session is refused
        expect((await a.request('/api/inspections/i1/media/video/other', {}, { DB: {} })).status).toBe(401);
    });

    it('a repeat lookup inside one request scope is shared (one inspection query per request)', async () => {
        const { createRequestScope, REQUEST_SCOPE } = await import('../../../server/lib/request-scope');
        const reached = { n: 0 };
        const appl = buildApp(PERSONAS.inspA!, reached);
        const scope = createRequestScope();
        vi.mocked(drizzle).mockClear();
        const env = { DB: {}, [REQUEST_SCOPE]: scope };
        const r1 = await appl.request(concrete(UNIQUE_ROUTES[0]!.path, INSP.own), { method: UNIQUE_ROUTES[0]!.method }, env);
        const r2 = await appl.request(concrete(UNIQUE_ROUTES[0]!.path, INSP.own), { method: UNIQUE_ROUTES[0]!.method }, env);
        expect([r1.status, r2.status]).toEqual([200, 200]);
        // two guard passes, one visibility lookup: drizzle() is built once for the lookup
        expect(vi.mocked(drizzle)).toHaveBeenCalledTimes(1);
    });
});
