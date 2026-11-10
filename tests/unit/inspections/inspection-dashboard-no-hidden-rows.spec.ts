/**
 * The inspections list is cut from the dashboard buckets, so an inspection that belongs to no bucket
 * is simply not on the list, while `GET /api/inspections` still returns it.
 *
 * The buckets are cut by date and status: today, within 7 days, beyond 7 days, completed with a published
 * report, cancelled in the last 30 days, and "needs attention". A freshly created inspection that is not
 * cancelled and is past-dated, or is `requested`/`confirmed` with a past date, or is completed
 * with a report still inside the unpublished grace period, matched none of them, until it was 72 hours old
 * and the unsigned-agreement rule picked it up. Observed: the newest of six inspections missing from the list
 * while the API returned all six, and reappearing as soon as its created_at was moved back.
 *
 * Every active inspection must land in at least one bucket: an unfinished past-dated one under needs attention, a completed one whose report is not yet published under recent reports. Cancelled ones are bounded by design (30 days, 20 rows).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ALL_INSPECTIONS } from '../../../server/lib/inspection/visibility';
import { lazyD1 } from '../helpers/d1-binding';

const testD1 = lazyD1();
const TENANT = '00000000-0000-0000-0000-0000000000f2';
const facadeStub = {} as unknown as import('../../../server/services/inspection.service').InspectionService;

type Buckets = Awaited<ReturnType<InspectionAnalyticsService['getDashboardBuckets']>>;
const ids = (r: Buckets) =>
    new Set([...r.recentReports, ...r.needsAttention, ...r.today, ...r.thisWeek, ...r.later, ...r.cancelled].map(i => i.id));
const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('dashboard buckets never hide an active inspection', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionAnalyticsService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        testD1.use(testDb);
        svc = new InspectionAnalyticsService(testD1.binding, undefined, undefined, undefined, undefined, facadeStub);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'hidden-rows', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    async function seed(id: string, over: Partial<typeof schema.inspections.$inferInsert>) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: id,
            date: dayOffset(30), status: 'scheduled', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            ...over,
        });
    }

    it('lists a brand-new past-dated confirmed inspection under needs attention', async () => {
        await seed('i-past-confirmed', { date: dayOffset(-5), status: 'confirmed' });
        const r = await svc.getDashboardBuckets(TENANT, ALL_INSPECTIONS);
        expect(r.needsAttention.map(i => i.id)).toContain('i-past-confirmed');
    });

    it('lists a brand-new requested inspection whose date has passed under needs attention', async () => {
        await seed('i-past-requested', { date: dayOffset(-2), status: 'requested' });
        const r = await svc.getDashboardBuckets(TENANT, ALL_INSPECTIONS);
        expect(r.needsAttention.map(i => i.id)).toContain('i-past-requested');
    });

    it('lists a freshly completed inspection with an unpublished report under recent reports, NOT needs attention', async () => {
        await seed('i-fresh-complete', { date: dayOffset(-1), status: 'completed' });
        const r = await svc.getDashboardBuckets(TENANT, ALL_INSPECTIONS);
        expect(r.recentReports.map(i => i.id)).toContain('i-fresh-complete');
        // The needs-attention card counts only what is listed there: a finished job inside its grace period is not late.
        expect(r.needsAttention.map(i => i.id)).not.toContain('i-fresh-complete');
        expect(ids(r)).toContain('i-fresh-complete');
    });

    it('lists each unplaced row exactly once', async () => {
        await seed('i-a', { date: dayOffset(-3), status: 'confirmed' });
        await seed('i-b', { date: dayOffset(-1), status: 'completed' });
        const r = await svc.getDashboardBuckets(TENANT, ALL_INSPECTIONS);
        const all = [...r.recentReports, ...r.needsAttention, ...r.today, ...r.thisWeek, ...r.later, ...r.cancelled].map(i => i.id);
        expect(all.filter(id => id === 'i-a')).toHaveLength(1);
        expect(all.filter(id => id === 'i-b')).toHaveLength(1);
    });

    it('still places the ordinary cases once (control: nothing is duplicated into the result)', async () => {
        await seed('i-later', { date: dayOffset(30), status: 'scheduled' });
        const r = await svc.getDashboardBuckets(TENANT, ALL_INSPECTIONS);
        expect(r.later.map(i => i.id)).toEqual(['i-later']);
        expect(r.needsAttention).toEqual([]);
    });

    it('does not resurrect a cancelled inspection older than the 30-day window', async () => {
        await seed('i-old-cancel', { status: 'cancelled', createdAt: new Date(Date.now() - 40 * 86_400_000) });
        expect(ids(await svc.getDashboardBuckets(TENANT, ALL_INSPECTIONS))).not.toContain('i-old-cancel');
    });
});
