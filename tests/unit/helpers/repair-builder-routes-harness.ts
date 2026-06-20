/**
 * Shared harness for the repair-builder route specs (split from the original
 * repair-builder-routes.spec.ts). The drizzle-orm/d1 + public-access module
 * mocks are registered per spec FILE (vi.mock is hoisted per-file); this module
 * only provides the chainable drizzle fakes, service stubs, and app builders.
 *
 * NOTE: every consumer spec MUST register, at its own top level:
 *   vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
 *   vi.mock('../../server/lib/public-access', ...resolveOwnerPreviewFull/resolveAgentSession -> null);
 * before importing this harness, so `mockDrizzle` here resolves to the mocked fn.
 */
import { vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import repairBuilderRoutes from '../../../server/api/repair-builder';
import type { HonoConfig } from '../../../server/types/hono';

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
export function makeTwoQueryDb(inspResult: unknown, cfgResult: unknown) {
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
export function makeGatePassDb() {
    return makeTwoQueryDb(
        { reportStatus: 'published' },
        { enableCustomerRepairExport: true },
    );
}

/**
 * Like makeGatePassDb but the inspection is not published — used to test
 * publish-gate rejection on CRUD routes without touching the service stubs.
 */
export function makeUnpublishedDb() {
    return makeTwoQueryDb(
        { reportStatus: 'in_progress' },
        { enableCustomerRepairExport: true },
    );
}

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------

export function makeServices(overrides: {
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

export function buildApp(opts: {
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
export const VALID_TOKEN_ROW = {
    inspectionId:   'insp1',
    tenantId:       't1',
    role:           'client',
    recipientEmail: 'buyer@example.com',
    revokedAt:      null,
    expiresAt:      null,
};

// ---------------------------------------------------------------------------
// Share view harness (Task 5)
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

export function makeShareDb(inspResult: unknown) {
    const chain = {
        select: () => chain,
        from:   () => chain,
        where:  () => ({
            get: async () => inspResult,
        }),
    };
    return chain;
}

export function makeShareServices(overrides: {
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

export const SHARE_RR = {
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
export const SHARE_ITEMS = [{ id: 'item1', requestedCreditCents: 5000, sortOrder: 0 }];
export const SHARE_INSP_PUBLISHED = { reportStatus: 'published', propertyAddress: '123 Main St' };
export const SHARE_INSP_UNPUBLISHED = { reportStatus: 'in_progress', propertyAddress: '123 Main St' };

export function buildShareApp(opts: {
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
