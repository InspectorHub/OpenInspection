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

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------

function makeServices(overrides: {
    portalAccessResolveToken?: ReturnType<typeof vi.fn>;
    resolveAgentViewToken?: ReturnType<typeof vi.fn>;
    getRepairList?: ReturnType<typeof vi.fn>;
    listMine?: ReturnType<typeof vi.fn>;
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
            listMine: overrides.listMine ?? defaultListMine,
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
}) {
    const {
        services,
        reportStatus = 'published',
        enableCustomerRepairExport = true,
        portalTokenRow = null,
    } = opts;

    const resolveToken = vi.fn().mockResolvedValue(portalTokenRow);
    const svc = services ?? makeServices({ portalAccessResolveToken: resolveToken });
    // Override portal token if provided separately
    if (!services && portalTokenRow !== null) {
        svc.portalAccess.resolveToken = resolveToken;
    }

    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        makeTwoQueryDb(
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
