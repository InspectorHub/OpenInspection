/**
 * Task 5 — authorized collab WS route auth tests.
 *
 * Asserts:
 *   (a) A request with no JWT (no tenantId / userId) is rejected 401/403/404
 *       and the INSPECTION_DOC DO namespace is never contacted.
 *   (b) A request for an inspection that belongs to a different tenant is
 *       rejected 403/404 and the DO is never contacted.
 *   (c) An authorized request (inspector on the inspection) passes and the DO
 *       namespace fetch is called with the correct headers.
 *
 * The DO namespace is fully mocked so no real DO is contacted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import collabRoutes from '../../../server/api/inspections/collab';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';

// ── Mock DO namespace helpers ─────────────────────────────────────────────────

// In Node's fetch API, status 101 is not valid — use 200 as a proxy for a
// successful DO forward (the real DO returns 101+webSocket in the CF runtime).
const MOCK_DO_SUCCESS = new Response(null, { status: 200 });

function makeMockDoNamespace(doFetchResponse?: Response) {
    const stubFetch = vi.fn().mockResolvedValue(
        doFetchResponse ?? MOCK_DO_SUCCESS,
    );
    const stub = { fetch: stubFetch };
    const get  = vi.fn().mockReturnValue(stub);
    const idFromName = vi.fn().mockReturnValue({ id: 'mock-do-id' });
    return { idFromName, get, stubFetch };
}

// ── App builder ───────────────────────────────────────────────────────────────

// The route now resolves who may edit from the ROSTER rather than from the
// inspection row's lead/helper columns. Mock that one module: this spec's
// subject is the route's 403/200 behaviour, not the SQL that fetches a roster
// (which tests/unit/inspections/roster.spec.ts pins, including on the SQL).
const getInspectionRoster = vi.fn();
vi.mock('../../../server/lib/inspection/roster', () => ({
    getInspectionRoster: (...args: unknown[]) => getInspectionRoster(...args),
}));

// The collab document is keyed per REPORT now, so the route resolves which one
// before it can address a Durable Object. Mocked for the same reason as the
// roster: this spec is about the route's auth and DO wiring, not about SQL.
const resolvePrimaryReportId = vi.fn();
vi.mock('../../../server/lib/inspection/reports', () => ({
    resolvePrimaryReportId: (...args: unknown[]) => resolvePrimaryReportId(...args),
}));

const member = (id: string) => ({ id, name: id, email: `${id}@example.com` });
const rosterOf = (lead: string | null, helpers: string[] = []) => ({
    lead: lead ? member(lead) : null,
    helpers: helpers.map(member),
});

interface BuildAppOptions {
    /** If null, simulate no JWT (middleware never ran). */
    tenantId?: string | null;
    userId?:   string | null;
    userRole?: string;
    /** The caller's permission_overrides row; undefined leaves the role defaults. */
    overrides?: Record<string, boolean> | null;
    /**
     * What getInspection returns (or throws). Only `inspectorId` — the roster
     * (who may edit) is a separate `getInspectionRoster` mock below;
     * `leadInspectorId` / `helperInspectorIds` are request-payload field names
     * only (`schedule.schema.ts`, `wizard.schema.ts`), never columns on the row
     * the route reads.
     */
    inspectionOverride?: {
        inspectorId?: string | null;
        tenantId?: string;
    } | 'not_found';
    doNamespace?: ReturnType<typeof makeMockDoNamespace>;
    /** The database the route reads the report's state from; default: an empty one. */
    binding?: D1Database;
    /** Who the roster says works this inspection. */
    roster?: { lead: string | null; helpers?: string[] };
}

function buildApp(opts: BuildAppOptions = {}) {
    const {
        tenantId      = 't1',
        userId        = 'u1',
        userRole      = 'inspector',
        overrides,
        inspectionOverride = {
            inspectorId: 'u1',
            tenantId: 't1',
        },
        doNamespace,
        roster,
        binding,
    } = opts;

    const mockDo = doNamespace ?? makeMockDoNamespace();

    // Default the roster to a solo inspector (lead = inspectorId, no helpers)
    // so each existing case keeps asserting the same thing it always did.
    // Cases that need a helper on the roster pass their own `roster` option
    // (see (c2)) rather than smuggling it through the inspection row.
    const effectiveRoster = roster ?? {
        lead: inspectionOverride === 'not_found'
            ? null
            : (inspectionOverride.inspectorId ?? null),
        helpers: [] as string[],
    };
    resolvePrimaryReportId.mockReset();
    resolvePrimaryReportId.mockResolvedValue('rpt-insp1');
    getInspectionRoster.mockReset();
    getInspectionRoster.mockResolvedValue(rosterOf(effectiveRoster.lead, effectiveRoster.helpers ?? []));

    // Build a fake inspection object from the override.
    const fakeInspection =
        inspectionOverride === 'not_found'
            ? undefined
            : {
                id:          'insp1',
                tenantId:    inspectionOverride.tenantId ?? 't1',
                inspectorId: inspectionOverride.inspectorId ?? 'u1',
            };

    const getInspection = vi.fn().mockImplementation(
        (_id: string, callerTenantId: string) => {
            if (inspectionOverride === 'not_found') throw new Error('not found');
            // Simulate tenant isolation: service throws when caller tenant ≠ row tenant.
            if (fakeInspection && fakeInspection.tenantId !== callerTenantId) {
                throw new Error('not found');
            }
            return Promise.resolve({ inspection: fakeInspection, template: null });
        },
    );

    const app = new OpenAPIHono<HonoConfig>();

    // Simulate what the global JWT middleware + DI middleware set.
    app.use('*', async (c, next) => {
        // Set env bindings before any handler sees it (mirrors repair-builder harness).
        c.env = { INSPECTION_DOC: mockDo, DB: binding ?? await emptyDb() } as unknown as HonoConfig['Bindings'];
        if (tenantId !== null)  c.set('tenantId', tenantId);
        if (userId   !== null)  c.set('user', { sub: userId } as never);
        if (userRole)           c.set('userRole', userRole as never);
        if (overrides !== undefined) c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as never);
        c.set('services', { inspection: { getInspection } } as never);
        await next();
    });

    app.route('/api/inspections', collabRoutes);
    return { app, mockDo, getInspection };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/** The socket route reads the report's state from D1 (a published report's socket is closed with 4409); an empty database says "not published". */
async function emptyDb(): Promise<D1Database> {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    return toD1Binding(fixture.sqlite);
}

describe('collab WS route — auth gate', () => {

    // ── editReports: opening the live editor needs the capability ─────────────

    it('(e1) refuses a rostered user whose editReports is off, and never contacts the DO', async () => {
        const { app, mockDo } = buildApp({ userRole: 'staff', overrides: null });
        const res = await app.request('/api/inspections/insp1/collab/ws', { headers: { Upgrade: 'websocket' } });
        expect(res.status).toBe(403);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('(e2) refuses an inspector whose editReports was withdrawn', async () => {
        const { app, mockDo } = buildApp({ overrides: { editReports: false } });
        const res = await app.request('/api/inspections/insp1/collab/ws', { headers: { Upgrade: 'websocket' } });
        expect(res.status).toBe(403);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('(e3) still refuses a staff user whose override says editReports, and admits an inspector (control)', async () => {
        const staff = buildApp({ userRole: 'staff', overrides: { editReports: true } });
        const refused = await staff.app.request('/api/inspections/insp1/collab/ws', { headers: { Upgrade: 'websocket' } });
        expect(refused.status).toBe(403);
        expect(staff.mockDo.idFromName).not.toHaveBeenCalled();
        const insp = buildApp({ userRole: 'inspector' });
        const res = await insp.app.request('/api/inspections/insp1/collab/ws', { headers: { Upgrade: 'websocket' } });
        expect(res.status).toBe(200);
        expect(insp.mockDo.idFromName).toHaveBeenCalled();
    });

    // ── (a) No auth ──────────────────────────────────────────────────────────

    it('(a1) rejects with 401 when tenantId is absent (no JWT)', async () => {
        const { app, mockDo } = buildApp({ tenantId: null, userId: null });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(401);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('(a2) rejects with 401 when userId is absent (tenantId present but no user sub)', async () => {
        const { app, mockDo } = buildApp({ userId: null });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(401);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    // ── (b) Cross-tenant / foreign-inspection ────────────────────────────────

    it('(b1) rejects with 404 when the inspection belongs to a different tenant', async () => {
        // The caller JWT says tenantId=t2, but the inspection's tenant is t1.
        const { app, mockDo } = buildApp({
            tenantId: 't2',
            userId:   'u-other',
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1', // row belongs to t1
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(404);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('(b2) rejects with 403 when the authenticated user is not on the inspection', async () => {
        const { app, mockDo } = buildApp({
            tenantId: 't1',
            userId:   'u-stranger',  // not inspectorId / lead / helper
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(403);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('(b3) rejects with 404 when the inspection does not exist', async () => {
        const { app, mockDo } = buildApp({ inspectionOverride: 'not_found' });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(404);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    // ── (c) Authorized — DO is contacted with correct identity headers ────────

    it('(c1) authorized primary inspector — DO idFromName called with tenantId:reportId', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u1',
            userRole:  'inspector',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
        });
        await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:rpt-insp1');
        expect(mockDo.get).toHaveBeenCalled();
        const fetchCall = mockDo.stubFetch.mock.calls[0][0] as Request;
        expect(fetchCall.headers.get('x-tenant-id')).toBe('t1');
        expect(fetchCall.headers.get('x-inspection-id')).toBe('insp1');
        expect(fetchCall.headers.get('Upgrade')).toBe('websocket');
    });

    it('(c2) authorized helper inspector — DO is contacted', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u-helper',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
            roster: { lead: 'u1', helpers: ['u-helper'] },
        });
        await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:rpt-insp1');
    });

    // ── (d) Role-based access — owner/manager bypass assignment check ────────
    //
    // ⚠️ `owner`, not `admin`. This case read `userRole: 'admin'` and passed
    // against a role this product does not have — `ROLES` is
    // `owner | manager | inspector | agent` — while the real owner was refused.
    // A spec that invents its vocabulary agrees with the bug.

    it('(d1) the owner, NOT assigned to the inspection, is authorized', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u-owner',
            userRole:  'owner',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        // Must NOT be 403 — admin bypasses assignment check.
        expect(res.status).not.toBe(403);
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:rpt-insp1');
    });

    it('(d2) manager user who is NOT assigned to the inspection is authorized', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u-manager',
            userRole:  'manager',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).not.toBe(403);
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:rpt-insp1');
    });

    it('(d3) inspector user who is NOT assigned is still denied 403', async () => {
        const { app, mockDo } = buildApp({
            tenantId:  't1',
            userId:    'u-stranger',
            userRole:  'inspector',
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(403);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('(d4) unknown/empty role without assignment is denied 403 (fail-closed)', async () => {
        const { app, mockDo } = buildApp({
            tenantId:  't1',
            userId:    'u-stranger',
            userRole:  '',
            inspectionOverride: {
                inspectorId: 'u1',
                tenantId:    't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(403);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    // ── Protocol checks ───────────────────────────────────────────────────────

    it('returns 426 when Upgrade header is missing', async () => {
        const { app, mockDo } = buildApp();
        const res = await app.request('/api/inspections/insp1/collab/ws');
        expect(res.status).toBe(426);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
    });

    it('returns 501 when INSPECTION_DOC binding is absent', async () => {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            // INSPECTION_DOC is intentionally NOT in env (absent binding).
            c.env = {} as unknown as HonoConfig['Bindings'];
            c.set('tenantId', 't1');
            c.set('user', { sub: 'u1' } as never);
            c.set('services', {
                inspection: {
                    getInspection: vi.fn().mockResolvedValue({
                        inspection: {
                            id: 'insp1',
                            tenantId: 't1',
                            inspectorId: 'u1',
                        },
                        template: null,
                    }),
                },
            } as never);
            await next();
        });
        app.route('/api/inspections', collabRoutes);
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).toBe(501);
    });
    describe('(r) a published report', () => {
        async function stateDb(status: 'published' | 'in_progress', publishedAt: Date | null, orderStatus: 'published' | 'in_progress' = 'published') {
            const fixture = createTestDb();
            await setupSchema(fixture.sqlite);
            await fixture.db.insert(schema.tenants).values({ id: 't1', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
            await fixture.db.insert(schema.inspections).values({ id: 'insp1', tenantId: 't1', propertyAddress: '1 Main', date: '2026-06-01', reportStatus: orderStatus, createdAt: new Date() } as never);
            await fixture.db.insert(schema.reports).values({ id: 'rpt-insp1', tenantId: 't1', inspectionId: 'insp1', kind: 'primary', title: 'R', status, publishedAt, createdAt: new Date() });
            return toD1Binding(fixture.sqlite);
        }
        const upgrade = async (binding: D1Database) => {
            const mockDo = makeMockDoNamespace();
            const { app } = buildApp({ doNamespace: mockDo, binding });
            await app.request('/api/inspections/insp1/collab/ws', { headers: { Upgrade: 'websocket' } });
            return (mockDo.stubFetch.mock.calls[0][0] as Request).headers.get('x-report-locked');
        };

        it('tells the document so (x-report-locked: 1) and still forwards the upgrade, so the socket can be closed with a readable code', async () => {
            expect(await upgrade(await stateDb('published', new Date()))).toBe('1');
        });

        it('says 0 for a report an older retract left published when its order is back in draft', async () => {
            expect(await upgrade(await stateDb('published', new Date(), 'in_progress'))).toBe('0');
        });

        it('says 0 while the report is a draft or is being edited again (control)', async () => {
            expect(await upgrade(await stateDb('in_progress', null))).toBe('0');
            expect(await upgrade(await stateDb('in_progress', new Date()))).toBe('0');
        });
    });
});
