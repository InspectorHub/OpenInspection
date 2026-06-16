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
    };
});

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { resolveOwnerPreviewFull } from '../../server/lib/public-access';

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
    // CRUD overrides
    create?: ReturnType<typeof vi.fn>;
    get?: ReturnType<typeof vi.fn>;
    addItem?: ReturnType<typeof vi.fn>;
    updateItem?: ReturnType<typeof vi.fn>;
    removeItem?: ReturnType<typeof vi.fn>;
    setIntro?: ReturnType<typeof vi.fn>;
    creditTotal?: ReturnType<typeof vi.fn>;
    assertCanEdit?: ReturnType<typeof vi.fn>;
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
        repairRequest: {
            listMine:      overrides.listMine ?? defaultListMine,
            create:        overrides.create ?? vi.fn().mockResolvedValue({ id: 'rr1', shareToken: 'tok-share' }),
            get:           overrides.get ?? vi.fn().mockResolvedValue(null),
            addItem:       overrides.addItem ?? vi.fn().mockResolvedValue({ id: 'item1' }),
            updateItem:    overrides.updateItem ?? vi.fn().mockResolvedValue(undefined),
            removeItem:    overrides.removeItem ?? vi.fn().mockResolvedValue(undefined),
            setIntro:      overrides.setIntro ?? vi.fn().mockResolvedValue(undefined),
            creditTotal:   overrides.creditTotal ?? vi.fn().mockResolvedValue(0),
            assertCanEdit: overrides.assertCanEdit ?? vi.fn().mockResolvedValue(undefined),
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
        expect(get).toHaveBeenCalledWith('t1', 'rr1');
        expect(creditTotal).toHaveBeenCalledWith('t1', 'rr1');
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
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
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
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(updateItem).toHaveBeenCalledWith('t1', 'rr1', 'item1', { requestedCreditCents: 10000, note: 'Updated note' });
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
        expect(updateItem).toHaveBeenCalledWith('t1', 'rr1', 'item1', { sortOrder: 3 });
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
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(removeItem).toHaveBeenCalledWith('t1', 'rr1', 'item1');
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
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(setIntro).toHaveBeenCalledWith('t1', 'rr1', 'Please fix these items.');
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
        expect(setIntro).toHaveBeenCalledWith('t1', 'rr1', null);
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
