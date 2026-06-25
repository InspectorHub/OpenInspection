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

interface BuildAppOptions {
    /** If null, simulate no JWT (middleware never ran). */
    tenantId?: string | null;
    userId?:   string | null;
    userRole?: string;
    /** What getInspection returns (or throws). */
    inspectionOverride?: {
        inspectorId?: string | null;
        leadInspectorId?: string | null;
        helperInspectorIds?: string;
        tenantId?: string;
    } | 'not_found';
    doNamespace?: ReturnType<typeof makeMockDoNamespace>;
}

function buildApp(opts: BuildAppOptions = {}) {
    const {
        tenantId      = 't1',
        userId        = 'u1',
        userRole      = 'inspector',
        inspectionOverride = {
            inspectorId: 'u1',
            leadInspectorId: 'u1',
            helperInspectorIds: '[]',
            tenantId: 't1',
        },
        doNamespace,
    } = opts;

    const mockDo = doNamespace ?? makeMockDoNamespace();

    // Build a fake inspection object from the override.
    const fakeInspection =
        inspectionOverride === 'not_found'
            ? undefined
            : {
                id:                 'insp1',
                tenantId:           inspectionOverride.tenantId ?? 't1',
                inspectorId:        inspectionOverride.inspectorId ?? 'u1',
                leadInspectorId:    inspectionOverride.leadInspectorId ?? 'u1',
                helperInspectorIds: inspectionOverride.helperInspectorIds ?? '[]',
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
        c.env = { INSPECTION_DOC: mockDo } as unknown as HonoConfig['Bindings'];
        if (tenantId !== null)  c.set('tenantId', tenantId);
        if (userId   !== null)  c.set('user', { sub: userId } as never);
        if (userRole)           c.set('userRole', userRole as never);
        c.set('services', { inspection: { getInspection } } as never);
        await next();
    });

    app.route('/api/inspections', collabRoutes);
    return { app, mockDo, getInspection };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('collab WS route — auth gate', () => {

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
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1', // row belongs to t1
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
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1',
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

    it('(c1) authorized primary inspector — DO idFromName called with tenantId:inspectionId', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u1',
            userRole:  'inspector',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1',
            },
        });
        await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:insp1');
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
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '["u-helper"]',
                tenantId:           't1',
            },
        });
        await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:insp1');
    });

    // ── (d) Role-based access — admin/manager bypass assignment check ────────

    it('(d1) admin user who is NOT assigned to the inspection is authorized', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u-admin',
            userRole:  'admin',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        // Must NOT be 403 — admin bypasses assignment check.
        expect(res.status).not.toBe(403);
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:insp1');
    });

    it('(d2) manager user who is NOT assigned to the inspection is authorized', async () => {
        const mockDo = makeMockDoNamespace();
        const { app } = buildApp({
            tenantId:  't1',
            userId:    'u-manager',
            userRole:  'manager',
            doNamespace: mockDo,
            inspectionOverride: {
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1',
            },
        });
        const res = await app.request(
            '/api/inspections/insp1/collab/ws',
            { headers: { Upgrade: 'websocket' } },
        );
        expect(res.status).not.toBe(403);
        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:insp1');
    });

    it('(d3) inspector user who is NOT assigned is still denied 403', async () => {
        const { app, mockDo } = buildApp({
            tenantId:  't1',
            userId:    'u-stranger',
            userRole:  'inspector',
            inspectionOverride: {
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1',
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
                inspectorId:        'u1',
                leadInspectorId:    'u1',
                helperInspectorIds: '[]',
                tenantId:           't1',
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
                            leadInspectorId: 'u1',
                            helperInspectorIds: '[]',
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
});
