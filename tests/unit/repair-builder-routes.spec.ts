/**
 * TDD tests for GET /api/public/repair-builder/:tenant/:id/source
 *
 * Gates:
 *  1. Auth — portal token / legacy agent token / owner-preview (one must succeed)
 *  2. Publish — report must be published (raw drizzle gate)
 *  3. Tenant flag — enableCustomerRepairExport must be true
 *
 * Happy path returns { data: { defects: [...], mine: [...] } }.
 *
 * Harness pattern mirrors repair-request-get.spec.ts:
 *  - vi.mock drizzle-orm/d1 so handler's drizzle(c.env.DB) returns our fake
 *  - stub c.set('services', ...) with the needed service methods
 *  - set c.env = { DB: {} }
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { resolveOwnerPreviewFull, resolveAgentSession } from '../../server/lib/public-access';

// Import AFTER mock registration
// eslint-disable-next-line import/order
import repairBuilderRoutes from '../../server/api/repair-builder';
import type { HonoConfig } from '../../server/types/hono';

// ---------------------------------------------------------------------------
// Chainable drizzle fake helpers
// ---------------------------------------------------------------------------

/**
 * Returns a chainable fake for `drizzle(DB).select(...).from(...).where(...).get()`.
 * The first call to the chain returns `inspResult`, the second returns `cfgResult`.
 * This covers the two sequential raw queries the route performs:
 *   1. publish gate  → inspections.reportStatus
 *   2. tenant flag   → tenantConfigs.enableCustomerRepairExport
 */
function makeTwoQueryDb(inspResult: unknown, cfgResult: unknown) {
    let callCount = 0;
    const chain = {
        select: () => chain,
        from:   () => chain,
        where:  () => ({
            get: async () => {
                callCount++;
                return callCount === 1 ? inspResult : cfgResult;
            },
        }),
    };
    return chain;
}

/**
 * Returns a chainable fake that always returns the gate queries successfully
 * (published + flag enabled). Used by CRUD route tests where the service
 * stubs handle all business logic; the raw-drizzle gate just needs to pass.
 */
function makeGatePassDb() {
    return makeTwoQueryDb(
        { reportStatus: 'published' },
        { enableCustomerRepairExport: true },
    );
}

/**
 * Like makeGatePassDb but the inspection is not published — used to test
 * publish-gate rejection on CRUD routes without touching the service stubs.
 */
function makeUnpublishedDb() {
    return makeTwoQueryDb(
        { reportStatus: 'in_progress' },
        { enableCustomerRepairExport: true },
    );
}

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------

function makeServices(overrides: {
    portalAccessResolveToken?: ReturnType<typeof vi.fn>;
    resolveAgentViewToken?: ReturnType<typeof vi.fn>;
    getRepairList?: ReturnType<typeof vi.fn>;
    listMine?: ReturnType<typeof vi.fn>;
    listMineWithItems?: ReturnType<typeof vi.fn>;
    // CRUD overrides
    create?: ReturnType<typeof vi.fn>;
    get?: ReturnType<typeof vi.fn>;
    addItem?: ReturnType<typeof vi.fn>;
    updateItem?: ReturnType<typeof vi.fn>;
    removeItem?: ReturnType<typeof vi.fn>;
    setIntro?: ReturnType<typeof vi.fn>;
    creditTotal?: ReturnType<typeof vi.fn>;
    assertCanEdit?: ReturnType<typeof vi.fn>;
    accessToInspection?: ReturnType<typeof vi.fn>;
} = {}) {
    const defaultPortalToken = vi.fn().mockResolvedValue(null);
    const defaultAgent = vi.fn().mockResolvedValue(null);
    const defaultRepairList = vi.fn().mockResolvedValue({ defects: [] });
    const defaultListMine = vi.fn().mockResolvedValue([]);

    return {
        portalAccess: {
            resolveToken: overrides.portalAccessResolveToken ?? defaultPortalToken,
        },
        inspection: {
            resolveAgentViewToken: overrides.resolveAgentViewToken ?? defaultAgent,
            getRepairList:         overrides.getRepairList ?? defaultRepairList,
        },
        agent: {
            accessToInspection: overrides.accessToInspection ?? vi.fn().mockResolvedValue(null),
        },
        repairRequest: {
            listMine:          overrides.listMine ?? defaultListMine,
            // B1: source route now calls listMineWithItems; default to same value as listMine
            listMineWithItems: overrides.listMineWithItems ?? overrides.listMine ?? defaultListMine,
            create:            overrides.create ?? vi.fn().mockResolvedValue({ id: 'rr1', shareToken: 'tok-share' }),
            get:               overrides.get ?? vi.fn().mockResolvedValue(null),
            addItem:           overrides.addItem ?? vi.fn().mockResolvedValue({ id: 'item1' }),
            updateItem:        overrides.updateItem ?? vi.fn().mockResolvedValue(undefined),
            removeItem:        overrides.removeItem ?? vi.fn().mockResolvedValue(undefined),
            setIntro:          overrides.setIntro ?? vi.fn().mockResolvedValue(undefined),
            creditTotal:       overrides.creditTotal ?? vi.fn().mockResolvedValue(0),
            assertCanEdit:     overrides.assertCanEdit ?? vi.fn().mockResolvedValue(undefined),
        },
    };
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

function buildApp(opts: {
    services?: ReturnType<typeof makeServices>;
    reportStatus?: string;
    enableCustomerRepairExport?: boolean;
    portalTokenRow?: Record<string, unknown> | null;
    /** Override the drizzle mock factory — defaults to makeTwoQueryDb for gate queries. */
    dbFactory?: () => unknown;
}) {
    const {
        services,
        reportStatus = 'published',
        enableCustomerRepairExport = true,
        portalTokenRow = null,
        dbFactory,
    } = opts;

    const resolveToken = vi.fn().mockResolvedValue(portalTokenRow);
    const svc = services ?? makeServices({ portalAccessResolveToken: resolveToken });
    // Override portal token if provided separately
    if (!services && portalTokenRow !== null) {
        svc.portalAccess.resolveToken = resolveToken;
    }

    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        dbFactory
            ? dbFactory()
            : makeTwoQueryDb(
                { reportStatus },
                { enableCustomerRepairExport },
            ),
    );

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.env = { DB: {} } as unknown as HonoConfig['Bindings'];
        c.set('services', svc as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/public', repairBuilderRoutes);
    return { app, svc };
}

// A valid portal token row (inspectionId matches 'insp1')
const VALID_TOKEN_ROW = {
    inspectionId:   'insp1',
    tenantId:       't1',
    role:           'client',
    recipientEmail: 'buyer@example.com',
    revokedAt:      null,
    expiresAt:      null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/public/repair-builder/:tenant/:id/source', () => {

    it('200 with defects + mine when published report + valid client token', async () => {
        const getRepairList = vi.fn().mockResolvedValue({
            defects: [
                {
                    sectionId:        's1',
                    sectionTitle:     'Roof',
                    itemId:           'item1',
                    itemLabel:        'Shingles',
                    comment:          'Missing shingles',
                    category:         'safety' as const,
                    source:           'canned' as const,
                    recommendationId: 'missing-shingles',
                },
            ],
        });
        const listMine = vi.fn().mockResolvedValue([{ id: 'rr1' }]);
        const resolveToken = vi.fn().mockResolvedValue(VALID_TOKEN_ROW);

        const { app } = buildApp({
            services: makeServices({ portalAccessResolveToken: resolveToken, getRepairList, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: { defects: unknown[]; mine: unknown[] };
        };
        expect(body.success).toBe(true);
        expect(body.data.defects).toHaveLength(1);
        expect((body.data.defects[0] as Record<string, unknown>).findingKey).toBe('canned:s1:item1:missing-shingles');
        expect((body.data.defects[0] as Record<string, unknown>).category).toBe('safety');
        expect(body.data.mine).toHaveLength(1);

        // Confirm getRepairList was called with the authoritative tenantId from the token
        expect(getRepairList).toHaveBeenCalledWith('insp1', 't1');
        // Confirm listMine was called with a client creator
        expect(listMine).toHaveBeenCalledWith(
            't1',
            'insp1',
            { kind: 'client', ref: 'buyer@example.com' },
        );
    });

    it('401 when no token is supplied', async () => {
        const { app } = buildApp({ reportStatus: 'published' });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source');
        expect(res.status).toBe(401);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('401 when the portal token maps to a different inspection', async () => {
        const wrongRow = { ...VALID_TOKEN_ROW, inspectionId: 'other-insp' };
        const { app } = buildApp({ portalTokenRow: wrongRow, reportStatus: 'published' });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(401);
    });

    it('403 NOT_PUBLISHED when report is in_progress and valid client token', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            reportStatus: 'in_progress',
            enableCustomerRepairExport: true,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('403 NOT_PUBLISHED when report is submitted (not yet published)', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            reportStatus: 'submitted',
            enableCustomerRepairExport: true,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('403 FORBIDDEN when tenant flag is OFF (published report, valid token)', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            reportStatus: 'published',
            enableCustomerRepairExport: false,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('FORBIDDEN');
    });

    it('200 via legacy agent-view-token fallback', async () => {
        // Portal token resolves null, but legacy agent token resolves the inspection
        const resolveAgentViewToken = vi.fn().mockResolvedValue({
            inspectionId: 'insp1',
            tenantId:     't2',
        });
        const listMine = vi.fn().mockResolvedValue([]);

        const { app } = buildApp({
            services: makeServices({ resolveAgentViewToken, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        const res = await app.request('/api/public/repair-builder/t2/insp1/source?token=kvtok');
        expect(res.status).toBe(200);
        // Creator should be {kind:'agent', ref: token string}
        expect(listMine).toHaveBeenCalledWith('t2', 'insp1', { kind: 'agent', ref: 'kvtok' });
    });

    it('403 NOT_PUBLISHED for owner-preview on an unpublished (in_progress) report', async () => {
        // Simulate owner-preview: portal + agent tokens both null, but
        // resolveOwnerPreviewFull (mocked at module level) resolves a valid session.
        vi.mocked(resolveOwnerPreviewFull).mockResolvedValueOnce({
            tenantId: 't1',
            userId:   'user-owner',
        });

        const { app } = buildApp({
            // No portal token — both path-1 and path-2 will resolve null.
            reportStatus: 'in_progress',
            enableCustomerRepairExport: true,
        });

        // Owner-preview uses Bearer JWT in Authorization header, not ?token=
        const res = await app.request(
            '/api/public/repair-builder/t1/insp1/source',
            { headers: { Authorization: 'Bearer owner-jwt' } },
        );

        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('200 via authenticated agent-portal session (tokenless dashboard link)', async () => {
        // Portal + legacy tokens null; owner-preview null; agent session resolves a
        // logged-in agent who IS associated with the inspection. The authoritative
        // tenantId comes from accessToInspection (the inspection row), NOT the URL.
        vi.mocked(resolveAgentSession).mockResolvedValueOnce({ userId: 'agent-user-1' });
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't-real' });
        const listMine = vi.fn().mockResolvedValue([]);

        const { app } = buildApp({
            services: makeServices({ accessToInspection, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        // URL tenant is 't-WRONG' on purpose — must be ignored.
        const res = await app.request(
            '/api/public/repair-builder/t-WRONG/insp1/source',
            { headers: { Authorization: 'Bearer agent-jwt' } },
        );
        expect(res.status).toBe(200);
        // Association check is keyed on the agent userId + inspection id (not URL tenant).
        expect(accessToInspection).toHaveBeenCalledWith('agent-user-1', 'insp1');
        // creator.ref is the stable agent userId; tenantId is the authoritative one.
        expect(listMine).toHaveBeenCalledWith('t-real', 'insp1', { kind: 'agent', ref: 'agent-user-1' });
    });

    it('401 when agent session is valid but agent is NOT associated with the inspection', async () => {
        vi.mocked(resolveAgentSession).mockResolvedValueOnce({ userId: 'agent-user-1' });
        const accessToInspection = vi.fn().mockResolvedValue(null); // no claim
        const listMine = vi.fn().mockResolvedValue([]);

        const { app } = buildApp({
            services: makeServices({ accessToInspection, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        const res = await app.request(
            '/api/public/repair-builder/t1/insp1/source',
            { headers: { Authorization: 'Bearer agent-jwt' } },
        );
        expect(res.status).toBe(401);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(accessToInspection).toHaveBeenCalledWith('agent-user-1', 'insp1');
        expect(listMine).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// CRUD builder routes
// ---------------------------------------------------------------------------
//
// All CRUD routes share the same gate: auth → publish → tenant-flag.
// Mutating routes additionally call assertCanEdit (checks creator ownership).
// The gate is exercised via the raw drizzle mock (makeTwoQueryDb); all
// business logic is handled by the service stubs.
//
// Helpers: VALID_TOKEN_ROW (client auth) + makeGatePassDb / makeUnpublishedDb.

describe('POST /api/public/repair-builder/:tenant/:id — create list', () => {
    it('200 and returns rr with id + shareToken for valid client', async () => {
        const createdRr = { id: 'rr-new', shareToken: 'share-abc', inspectionId: 'insp1', tenantId: 't1' };
        const create = vi.fn().mockResolvedValue(createdRr);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), create }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        expect(body.data.id).toBe('rr-new');
        expect(body.data.shareToken).toBe('share-abc');
        expect(create).toHaveBeenCalledWith('t1', 'insp1', { kind: 'client', ref: 'buyer@example.com' });
    });

    it('401 when no auth token provided', async () => {
        const { app } = buildApp({ dbFactory: makeGatePassDb });
        const res = await app.request('/api/public/repair-builder/t1/insp1', { method: 'POST' });
        expect(res.status).toBe(401);
    });

    it('403 NOT_PUBLISHED for create on an unpublished report', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW) }),
            dbFactory: makeUnpublishedDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });
});

describe('GET /api/public/repair-builder/:tenant/:id/lists/:rrId — get list', () => {
    const RR = { id: 'rr1', inspectionId: 'insp1', tenantId: 't1', createdByKind: 'client', createdByRef: 'buyer@example.com' };
    const ITEMS = [{ id: 'item1', requestedCreditCents: 5000, sortOrder: 0 }];

    it('200 with request + items + creditTotal', async () => {
        const get = vi.fn().mockResolvedValue({ request: RR, items: ITEMS });
        const creditTotal = vi.fn().mockResolvedValue(5000);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), get, creditTotal }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { request: unknown; items: unknown[]; creditTotal: number } };
        expect(body.success).toBe(true);
        expect(body.data.items).toHaveLength(1);
        expect(body.data.creditTotal).toBe(5000);
        // I1: get() and creditTotal() now receive inspectionId as 2nd arg.
        expect(get).toHaveBeenCalledWith('t1', 'insp1', 'rr1');
        expect(creditTotal).toHaveBeenCalledWith('t1', 'insp1', 'rr1');
    });

    it('404 when rr does not exist', async () => {
        const get = vi.fn().mockResolvedValue(null);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), get }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/no-such?token=tok1');
        expect(res.status).toBe(404);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');
    });
});

describe('POST .../lists/:rrId/items — add item', () => {
    const ITEM_BODY = {
        findingKey: 'canned:s1:item1:roof',
        sectionTitle: 'Roof',
        itemLabel: 'Missing shingles',
        requestedCreditCents: 25000,
        note: 'Needs full replacement',
    };

    it('200 and returns the new item', async () => {
        const newItem = { id: 'item-new', ...ITEM_BODY };
        const addItem = vi.fn().mockResolvedValue(newItem);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), addItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        expect(body.data.id).toBe('item-new');
        // I1: assertCanEdit now receives inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        // Route normalizes undefined optional fields to null per ItemInput.
        expect(addItem).toHaveBeenCalledWith('t1', 'rr1', { ...ITEM_BODY, commentSnapshot: null });
    });

    it('403 FORBIDDEN when assertCanEdit throws (not the creator)', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Not the creator'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });

    it('403 NOT_PUBLISHED when report is unpublished (publish gate on add-item)', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW) }),
            dbFactory: makeUnpublishedDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('400 when requestedCreditCents is negative', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW) }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ITEM_BODY, requestedCreditCents: -1 }),
        });
        expect(res.status).toBe(400);
    });
});

describe('PATCH .../lists/:rrId/items/:itemId — update item', () => {
    it('200 on valid patch (requestedCreditCents + note)', async () => {
        const updateItem = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), updateItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestedCreditCents: 10000, note: 'Updated note' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // I1: assertCanEdit and updateItem now receive inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(updateItem).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'item1', { requestedCreditCents: 10000, note: 'Updated note' });
    });

    it('200 on valid patch (sortOrder only)', async () => {
        const updateItem = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), updateItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortOrder: 3 }),
        });
        expect(res.status).toBe(200);
        expect(updateItem).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'item1', { sortOrder: 3 });
    });

    it('403 FORBIDDEN from assertCanEdit on patch', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Forbidden'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'hi' }),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

describe('DELETE .../lists/:rrId/items/:itemId — remove item', () => {
    it('200 on successful delete', async () => {
        const removeItem = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), removeItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'DELETE',
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // I1: assertCanEdit and removeItem now receive inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(removeItem).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'item1');
    });

    it('403 FORBIDDEN from assertCanEdit on delete', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Forbidden'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'DELETE',
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

describe('PATCH .../lists/:rrId — set intro', () => {
    it('200 on setIntro', async () => {
        const setIntro = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), setIntro, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customIntro: 'Please fix these items.' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // I1: assertCanEdit and setIntro now receive inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(setIntro).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'Please fix these items.');
    });

    it('200 when customIntro is null (clearing)', async () => {
        const setIntro = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), setIntro, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customIntro: null }),
        });
        expect(res.status).toBe(200);
        expect(setIntro).toHaveBeenCalledWith('t1', 'insp1', 'rr1', null);
    });

    it('403 FORBIDDEN from assertCanEdit on setIntro', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Forbidden'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customIntro: 'try to edit' }),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

// ---------------------------------------------------------------------------
// Share view routes (Task 5)
// ---------------------------------------------------------------------------
//
// These routes are PUBLIC — the shareToken is the credential.
// All three (GET /share/:token, GET /share/:token/pdf, POST /share/:token/email)
// run a publish gate: getByShareToken → inspect reportStatus → 403 if not published.
//
// Drizzle mock pattern for share routes:
//   - The share gate calls getByShareToken on the service (not raw drizzle).
//   - Then does ONE raw drizzle query on inspections (by inspectionId + tenantId)
//     to check reportStatus + get propertyAddress.
//   So the share drizzle mock only needs to handle one query.

function makeShareDb(inspResult: unknown) {
    const chain = {
        select: () => chain,
        from:   () => chain,
        where:  () => ({
            get: async () => inspResult,
        }),
    };
    return chain;
}

function makeShareServices(overrides: {
    getByShareToken?: ReturnType<typeof vi.fn>;
    creditTotal?: ReturnType<typeof vi.fn>;
    sendEmail?: ReturnType<typeof vi.fn>;
} = {}) {
    return {
        portalAccess: { resolveToken: vi.fn().mockResolvedValue(null) },
        inspection:   { resolveAgentViewToken: vi.fn().mockResolvedValue(null) },
        repairRequest: {
            getByShareToken: overrides.getByShareToken ?? vi.fn().mockResolvedValue(null),
            creditTotal:     overrides.creditTotal ?? vi.fn().mockResolvedValue(0),
            // Keep stubs for existing CRUD routes so TS is happy
            listMine:      vi.fn().mockResolvedValue([]),
            create:        vi.fn().mockResolvedValue({ id: 'rr1', shareToken: 'tok-share' }),
            get:           vi.fn().mockResolvedValue(null),
            addItem:       vi.fn().mockResolvedValue({ id: 'item1' }),
            updateItem:    vi.fn().mockResolvedValue(undefined),
            removeItem:    vi.fn().mockResolvedValue(undefined),
            setIntro:      vi.fn().mockResolvedValue(undefined),
            assertCanEdit: vi.fn().mockResolvedValue(undefined),
        },
        email: {
            sendEmail: overrides.sendEmail ?? vi.fn().mockResolvedValue({ delivered: true }),
        },
    };
}

const SHARE_RR = {
    id:            'rr1',
    tenantId:      't1',
    inspectionId:  'insp1',
    createdByKind: 'client',
    createdByRef:  'buyer@example.com',
    customIntro:   'Please review',
    shareToken:    'share-tok-abc',
    createdAt:     new Date('2026-01-01'),
    updatedAt:     new Date('2026-01-01'),
};
const SHARE_ITEMS = [{ id: 'item1', requestedCreditCents: 5000, sortOrder: 0 }];
const SHARE_INSP_PUBLISHED = { reportStatus: 'published', propertyAddress: '123 Main St' };
const SHARE_INSP_UNPUBLISHED = { reportStatus: 'in_progress', propertyAddress: '123 Main St' };

function buildShareApp(opts: {
    rrResult?: { request: typeof SHARE_RR; items: typeof SHARE_ITEMS } | null;
    inspResult?: typeof SHARE_INSP_PUBLISHED | typeof SHARE_INSP_UNPUBLISHED | null;
    creditTotalResult?: number;
    sendEmail?: ReturnType<typeof vi.fn>;
    browserBinding?: unknown;
}) {
    const {
        rrResult = { request: SHARE_RR, items: SHARE_ITEMS },
        inspResult = SHARE_INSP_PUBLISHED,
        creditTotalResult = 5000,
        sendEmail,
        browserBinding,
    } = opts;

    const getByShareToken = vi.fn().mockResolvedValue(rrResult);
    const creditTotal = vi.fn().mockResolvedValue(creditTotalResult);
    const svc = makeShareServices({ getByShareToken, creditTotal, sendEmail });

    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        makeShareDb(inspResult),
    );

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.env = {
            DB:           {},
            APP_BASE_URL: 'https://app.example.com',
            BROWSER:      browserBinding,
        } as unknown as HonoConfig['Bindings'];
        c.set('services', svc as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/public', repairBuilderRoutes);
    return { app, svc };
}

describe('GET /api/public/repair-request/share/:shareToken', () => {
    it('200 with propertyAddress + customIntro + items + creditTotal for published report', async () => {
        const { app, svc } = buildShareApp({});

        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: {
                propertyAddress: string;
                customIntro: string | null;
                items: unknown[];
                creditTotal: number;
            };
        };
        expect(body.success).toBe(true);
        expect(body.data.propertyAddress).toBe('123 Main St');
        expect(body.data.customIntro).toBe('Please review');
        expect(body.data.items).toHaveLength(1);
        expect(body.data.creditTotal).toBe(5000);

        expect(svc.repairRequest.getByShareToken).toHaveBeenCalledWith('share-tok-abc');
        // Share route uses the RR's own inspectionId; creditTotal now takes (tenant, inspId, rrId).
        expect(svc.repairRequest.creditTotal).toHaveBeenCalledWith('t1', 'insp1', 'rr1');
    });

    it('404 when shareToken is unknown', async () => {
        const { app } = buildShareApp({ rrResult: null });

        const res = await app.request('/api/public/repair-request/share/no-such-token');
        expect(res.status).toBe(404);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_FOUND');
    });

    it('403 NOT_PUBLISHED when report is in_progress — does NOT leak items', async () => {
        const { app } = buildShareApp({ inspResult: SHARE_INSP_UNPUBLISHED });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_PUBLISHED');
        // Must not contain items
        expect(JSON.stringify(body)).not.toContain('item1');
    });

    it('403 NOT_PUBLISHED when inspection row missing (safety)', async () => {
        const { app } = buildShareApp({ inspResult: null });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });
});

describe('GET /api/public/repair-request/share/:shareToken/pdf', () => {
    it('403 NOT_PUBLISHED when report is unpublished', async () => {
        const { app } = buildShareApp({ inspResult: SHARE_INSP_UNPUBLISHED });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/pdf');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('404 when shareToken is unknown', async () => {
        const { app } = buildShareApp({ rrResult: null });

        const res = await app.request('/api/public/repair-request/share/no-token/pdf');
        expect(res.status).toBe(404);
    });

    it('200 with PDF bytes when BROWSER stub returns ok response', async () => {
        const fakeBuffer = new ArrayBuffer(4);
        const browserStub = {
            quickAction: vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: async () => fakeBuffer,
            }),
        };

        const { app } = buildShareApp({ browserBinding: browserStub });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/pdf');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');
        expect(res.headers.get('Content-Disposition')).toContain('repair-request.pdf');
        // Confirm the page URL passed to quickAction
        expect(browserStub.quickAction).toHaveBeenCalledWith('pdf', expect.objectContaining({
            url: expect.stringContaining('/repair-request/share-tok-abc'),
        }));
    });
});

describe('POST /api/public/repair-request/share/:shareToken/email', () => {
    it('403 NOT_PUBLISHED when report is unpublished', async () => {
        const { app } = buildShareApp({ inspResult: SHARE_INSP_UNPUBLISHED });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com' }),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('404 when shareToken is unknown', async () => {
        const { app } = buildShareApp({ rrResult: null });

        const res = await app.request('/api/public/repair-request/share/no-token/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com' }),
        });
        expect(res.status).toBe(404);
    });

    it('400 when "to" is missing or not a valid email', async () => {
        const { app } = buildShareApp({});

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'not-an-email' }),
        });
        expect(res.status).toBe(400);
    });

    it('200 on published report with valid email — calls sendEmail', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        const { app, svc } = buildShareApp({ sendEmail });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com', message: 'Please review.' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);

        expect(svc.email.sendEmail).toHaveBeenCalledWith(
            ['contractor@example.com'],
            expect.stringContaining('123 Main St'),
            expect.any(String),
        );
    });

    it('200 on published report with no optional message', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        const { app } = buildShareApp({ sendEmail });

        const res = await app.request('/api/public/repair-request/share/share-tok-abc/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'contractor@example.com' }),
        });
        expect(res.status).toBe(200);
    });
});

describe('assertCanEdit: different creator cannot edit', () => {
    it('403 when a different client ref tries to POST an item to a list they do not own', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        // assertCanEdit is called with creator = {kind:'client', ref:'buyer@example.com'},
        // but the RR was created by 'other@example.com' — service throws Forbidden.
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Not the creator of this repair request'));
        const ITEM_BODY = {
            findingKey: 'canned:s1:item1:roof',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
        };
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr-other/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

// ---------------------------------------------------------------------------
// B1: source route hydration — mine[].items must be populated
// ---------------------------------------------------------------------------

describe('B1: GET .../source → mine[0].items is populated from persisted list', () => {
    it('mine[0].items contains the item hydrated from get()', async () => {
        // Simulate: listMine returns one RR row (as listMineWithItems does now),
        // which already includes its items array.
        const persistedItem = {
            id: 'item-server-1',
            findingKey: 'canned:s1:item1:roof',
            sectionTitle: 'Roof',
            itemLabel: 'Missing shingles',
            commentSnapshot: 'worn',
            requestedCreditCents: 25000,
            note: null,
            sortOrder: 0,
        };
        const rrWithItems = {
            id: 'rr1',
            inspectionId: 'insp1',
            tenantId: 't1',
            customIntro: null,
            shareToken: 'share-tok',
            items: [persistedItem],
        };
        const listMine = vi.fn().mockResolvedValue([rrWithItems]);
        const resolveToken = vi.fn().mockResolvedValue(VALID_TOKEN_ROW);

        const { app } = buildApp({
            services: makeServices({ portalAccessResolveToken: resolveToken, listMine }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: { defects: unknown[]; mine: Array<{ id: string; items: unknown[] }> };
        };
        expect(body.success).toBe(true);
        expect(body.data.mine).toHaveLength(1);
        // The mine entry must carry the items array so the builder page can rehydrate
        expect(body.data.mine[0].items).toHaveLength(1);
        expect((body.data.mine[0].items[0] as Record<string, unknown>).findingKey).toBe('canned:s1:item1:roof');
    });
});

// ---------------------------------------------------------------------------
// I1: cross-inspection read via authed route — must return 404
// ---------------------------------------------------------------------------

describe('I1: GET /lists/:rrId — list belonging to inspection B is NOT returned for inspection A', () => {
    it('404 when rrId belongs to inspectionId B but URL uses inspectionId A', async () => {
        // The service's get() now takes (tenantId, inspectionId, rrId).
        // When rrId belongs to 'insp-B' but the URL says 'insp-A', get() returns null → 404.
        const get = vi.fn().mockResolvedValue(null); // inspectionId mismatch → null
        const resolveToken = vi.fn().mockResolvedValue(VALID_TOKEN_ROW); // grants access to insp1 (A)

        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: resolveToken, get }),
            dbFactory: makeGatePassDb,
        });

        // rrId-of-B is on inspection B; URL says inspection insp1 (A)
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rrId-of-B?token=tok1');
        expect(res.status).toBe(404);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');

        // Verify the route DID pass inspectionId to get()
        expect(get).toHaveBeenCalledWith('t1', 'insp1', 'rrId-of-B');
    });
});
