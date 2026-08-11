/**
 * GET /api/metrics — the per-inspector dimension (#278).
 *
 * REWRITTEN from the IA-63 version, which pinned `{ count, revenue,
 * avgTurnaroundDays }` grouped lead-only. Every one of those three fields is
 * gone, and each for a reason worth keeping:
 *
 *   - `count` became `ledCount` + `assistedCount`. A helper was on the job;
 *     hiding their work to keep one number clean is the wrong trade. The old
 *     lead-only grouping existed to stop revenue being double-counted, so the
 *     count widens and the COMPANY revenue figure does not come with it.
 *   - `revenue` became TWO figures: `payCents` (what the inspector earns) and
 *     `attributedRevenueCents` (what the business billed for the lines they
 *     worked). One column called "revenue" conflated them.
 *   - `avgTurnaroundDays` became `medianTurnaroundDays` + `turnaroundBasis`.
 *     A mean is dragged by one delayed report on a complex property, and a
 *     metric that silently reports nothing is worse than one that says why.
 *
 * The turnaround anchors moved too: END is `reports.published_at` (per
 * deliverable, nullable), not `report_versions.published_at` (NOT NULL, fires
 * per version and per amendment); START is `MAX(inspection_events.completed_at)`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import metricsRoutes from '../../../server/api/metrics';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

const TENANT = '00000000-0000-0000-0000-000000000001';
const U1 = 'user-inspector-1';
const U2 = 'user-inspector-2';
const SVC = 'svc-home';
const EVT = 'evt-type-1';
const DAY = 86_400_000;

let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole = 'owner', actor = 'owner-1', overrides: Record<string, boolean> | null = null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role);
        c.set('tenantId', TENANT);
        c.set('user', { sub: actor, role, tenantId: TENANT });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        await next();
    });
    app.route('/api/metrics', metricsRoutes);
    return app;
}

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

interface ByInspectorRow {
    inspectorId: string;
    inspectorName: string;
    ledCount: number;
    assistedCount: number;
    payCents: number;
    attributedRevenueCents: number | null;
    medianTurnaroundDays: number | null;
    turnaroundBasis: 'field_complete_to_report_published' | 'no_data';
}

interface Payload {
    scope: 'all' | 'self';
    totalRevenue: number | null;
    avgOrderValue: number | null;
    monthly: unknown[];
    topAgents: unknown[];
    serviceBreakdown: unknown[];
    paymentSummary: unknown;
    byInspector: ByInspectorRow[];
}

const fetchMetrics = async (app = buildApp()) => {
    const res = await app.request('/api/metrics?from=2026-01-01&to=2026-12-31', {}, ENV, CTX);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: Payload }).data;
};

const rowFor = (rows: ByInspectorRow[], id: string) => rows.find(r => r.inspectorId === id)!;

/** One inspection with one billing line, dated inside the window. */
async function seedInspection(id: string, priceCents: number, date = '2026-07-01') {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: `${id} Main St`, date,
        status: 'completed', paymentStatus: 'paid', price: priceCents, createdAt: new Date(),
    } as never);
    await db.insert(schema.inspectionServices).values({
        id: `line-${id}`, tenantId: TENANT, inspectionId: id, serviceId: SVC,
        nameSnapshot: 'Home Inspection', priceSnapshot: priceCents,
    } as never);
}

const assign = (inspectionId: string, userId: string, role: 'lead' | 'helper') =>
    db.insert(schema.inspectionInspectors).values({
        inspectionId, userId, tenantId: TENANT, role, createdAt: new Date(),
    } as never);

/** Field work finished — the turnaround START anchor. */
const fieldDone = (inspectionId: string, atMs: number) =>
    db.insert(schema.inspectionEvents).values({
        id: `ev-${inspectionId}-${atMs}`, tenantId: TENANT, inspectionId, eventTypeId: EVT,
        scheduledAt: new Date(atMs - DAY), durationMin: 120, status: 'completed',
        completedAt: new Date(atMs), createdAt: new Date(),
    } as never);

/** A deliverable going out — the turnaround END anchor. */
const publishReport = (id: string, inspectionId: string, atMs: number, kind: 'primary' | 'ancillary' = 'primary') =>
    db.insert(schema.reports).values({
        id, tenantId: TENANT, inspectionId, kind, title: 'Report',
        status: 'published', createdAt: new Date(atMs - DAY), publishedAt: new Date(atMs),
    } as never);

const payRow = (inspectionId: string, userId: string, amountCents: number) =>
    db.insert(schema.inspectionServicePaySplits).values({
        id: `split-${inspectionId}-${userId}`, tenantId: TENANT,
        inspectionServiceId: `line-${inspectionId}`, userId, amountCents,
        source: 'rule', lockedAt: null, correctsSplitId: null, reason: null,
        createdAt: new Date(), updatedAt: new Date(),
    } as never);

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values([
        { id: U1, tenantId: TENANT, email: 'ins1@acme.test', passwordHash: 'x', name: 'Alice Inspector', createdAt: new Date() },
        { id: U2, tenantId: TENANT, email: 'ins2@acme.test', passwordHash: 'x', name: 'Bob Inspector', createdAt: new Date() },
    ] as never);
    await db.insert(schema.services).values({
        id: SVC, tenantId: TENANT, name: 'Home Inspection', price: 50000, createdAt: new Date(),
    } as never);
    await db.insert(schema.eventTypes).values({
        id: EVT, tenantId: TENANT, name: 'On-site inspection', slug: 'on-site', createdAt: new Date(),
    } as never);
});

describe('byInspector — counts', () => {
    it('counts an inspection for every assigned inspector, lead and helper apart', async () => {
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await assign('i1', U2, 'helper');

        const rows = (await fetchMetrics()).byInspector;
        expect(rowFor(rows, U1)).toMatchObject({ ledCount: 1, assistedCount: 0 });
        expect(rowFor(rows, U2)).toMatchObject({ ledCount: 0, assistedCount: 1 });
    });
});

describe('byInspector — pay is not attributed revenue', () => {
    it('reports pay and attributed revenue as separate figures', async () => {
        // Conflating them is the error the two labels exist to prevent: pay is
        // what the inspector earns, attributed revenue is what the business
        // billed for work they did. They differ by margin.
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await payRow('i1', U1, 15000);

        const row = rowFor((await fetchMetrics()).byInspector, U1);
        expect(row.payCents).toBe(15000);
        expect(row.attributedRevenueCents).toBe(50000);
        expect(row.payCents).not.toEqual(row.attributedRevenueCents);
    });

    it('does NOT carry company revenue into the widened count', async () => {
        // The old lead-only grouping existed to stop exactly this. Two people
        // on one 50000c job: the company earned 50000 once, and the attributed
        // figure credits each of them with the line they worked — which is why
        // it is called attribution and is never summed across the column.
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await assign('i1', U2, 'helper');

        const data = await fetchMetrics();
        expect(data.totalRevenue).toBe(50000);
        expect(rowFor(data.byInspector, U1).attributedRevenueCents).toBe(50000);
        expect(rowFor(data.byInspector, U2).attributedRevenueCents).toBe(50000);
    });
});

describe('byInspector — turnaround', () => {
    it('reports no_data, not a substitute basis, when field work was never completed', async () => {
        // `inspection_events.completed_at` has no frontend writer yet, so this
        // is the case nearly every tenant is in. A turnaround computed off a
        // booking-confirmation timestamp measures how fast the office confirms
        // bookings — a different number wearing this one's name.
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await publishReport('r1', 'i1', Date.UTC(2026, 6, 4));

        const row = rowFor((await fetchMetrics()).byInspector, U1);
        expect(row.medianTurnaroundDays).toBeNull();
        expect(row.turnaroundBasis).toBe('no_data');
    });

    it('measures field completion to report publish, and attributes it to the lead only', async () => {
        await seedInspection('i1', 50000);
        // Helper assigned FIRST on purpose: "first row on the roster" and "the
        // lead" must not be allowed to coincide, or this test passes for an
        // implementation that just takes roster[0].
        await assign('i1', U2, 'helper');
        await assign('i1', U1, 'lead');
        await fieldDone('i1', Date.UTC(2026, 6, 1));
        await publishReport('r1', 'i1', Date.UTC(2026, 6, 3));

        const rows = (await fetchMetrics()).byInspector;
        expect(rowFor(rows, U1).medianTurnaroundDays).toBe(2);
        expect(rowFor(rows, U1).turnaroundBasis).toBe('field_complete_to_report_published');
        // The report is one artifact with one publisher; splitting a duration
        // between two people means nothing.
        expect(rowFor(rows, U2).medianTurnaroundDays).toBeNull();
    });

    it('takes the MEDIAN, so one delayed report does not restate the other three', async () => {
        const days = [1, 2, 3, 40];
        for (const [i, d] of days.entries()) {
            const id = `i${i}`;
            await seedInspection(id, 10000);
            await assign(id, U1, 'lead');
            await fieldDone(id, Date.UTC(2026, 6, 1));
            await publishReport(`r${i}`, id, Date.UTC(2026, 6, 1) + d * DAY);
        }
        // mean = 11.5; median = 2.5. The mean describes none of these jobs.
        expect(rowFor((await fetchMetrics()).byInspector, U1).medianTurnaroundDays).toBe(2.5);
    });

    it('uses the RIGHT report under a multi-report order', async () => {
        // The inherited bug: the old query joined report_versions on
        // version_number = 1 scoped by inspection_id alone, so an order
        // delivering several reports picked an arbitrary one's v1. Both
        // deliverables count here, and each against its own publish time.
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await fieldDone('i1', Date.UTC(2026, 6, 1));
        await publishReport('r-primary', 'i1', Date.UTC(2026, 6, 2), 'primary');
        await publishReport('r-radon', 'i1', Date.UTC(2026, 6, 8), 'ancillary');

        // Samples are 1 and 7 days; the median of the pair is 4.
        expect(rowFor((await fetchMetrics()).byInspector, U1).medianTurnaroundDays).toBe(4);
    });

    it('ignores an unpublished report rather than scoring it as zero', async () => {
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await fieldDone('i1', Date.UTC(2026, 6, 1));
        await db.insert(schema.reports).values({
            id: 'r-draft', tenantId: TENANT, inspectionId: 'i1', kind: 'primary',
            title: 'Draft', status: 'in_progress', createdAt: new Date(), publishedAt: null,
        } as never);

        const row = rowFor((await fetchMetrics()).byInspector, U1);
        expect(row.medianTurnaroundDays).toBeNull();
        expect(row.turnaroundBasis).toBe('no_data');
    });
});

describe('byInspector — an inspector sees a single-row view of themselves', () => {
    beforeEach(async () => {
        await seedInspection('i1', 50000);
        await assign('i1', U1, 'lead');
        await assign('i1', U2, 'helper');
        await payRow('i1', U1, 15000);
        await payRow('i1', U2, 15000);
    });

    it('returns only the caller row, and never a colleague name or amount', async () => {
        const res = await buildApp('inspector', U1).request('/api/metrics?from=2026-01-01&to=2026-12-31', {}, ENV, CTX);
        expect(res.status).toBe(200);
        const raw = await res.text();
        const data = (JSON.parse(raw) as { data: Payload }).data;

        expect(data.scope).toBe('self');
        expect(data.byInspector.map(r => r.inspectorId)).toEqual([U1]);
        expect(data.byInspector[0].payCents).toBe(15000);
        // A colleague's identity is absent from the payload, not hidden in it.
        expect(raw).not.toContain('Bob Inspector');
        expect(raw).not.toContain(U2);
    });

    it('withholds the company figures as null, not as zero', async () => {
        // Zero is a claim about the business; null says "not yours to see".
        const data = await fetchMetrics(buildApp('inspector', U1));
        expect(data.totalRevenue).toBeNull();
        expect(data.avgOrderValue).toBeNull();
        expect(data.paymentSummary).toBeNull();
        expect(data.monthly).toEqual([]);
        expect(data.topAgents).toEqual([]);
        expect(data.serviceBreakdown).toEqual([]);
        // Attributed revenue is the company's side of the line; pay is not.
        expect(data.byInspector[0].attributedRevenueCents).toBeNull();
        expect(data.byInspector[0].payCents).toBe(15000);
    });

    it('an inspector GRANTED financial sees the whole company — the line is the capability', async () => {
        const data = await fetchMetrics(buildApp('inspector', U1, { financial: true }));
        expect(data.scope).toBe('all');
        expect(data.byInspector.map(r => r.inspectorId).sort()).toEqual([U1, U2]);
        expect(data.totalRevenue).toBe(50000);
    });
});
