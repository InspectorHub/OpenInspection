import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { AnalyticsService } from '../../../server/services/analytics.service';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, INSP, VISIBLE_TO_A, ALL_OF_TENANT } from '../helpers/visibility-fixture';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };

describe('analytics reads honour the scope', () => {
    let svc: AnalyticsService;
    beforeEach(async () => {
        const f = createTestDb(); await setupSchema(f.sqlite); await seedVisibilityFixture(f.db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(f.db));
        // One rated item on each of two inspections. The rating matches no level, so each lands in `unresolved`,
        // which makes the number of inspections whose results were read directly countable.
        for (const id of [INSP.own, INSP.other]) {
            await f.db.insert(schema.inspectionResults).values({
                id: `res-${id}`, tenantId: TENANT, inspectionId: id, reportId: `rep-${id}`,
                data: { 'sec1:item1': { rating: 'zz-unknown' } }, lastSyncedAt: new Date(),
            });
        }
        svc = new AnalyticsService({} as D1Database);
    });
    const total = (g: { months: Array<{ count: number }> }) => g.months.reduce((s, m) => s + m.count, 0);

    it('growth counts the visible inspections only', async () => {
        expect(total(await svc.growth(TENANT, 12, A))).toBe(VISIBLE_TO_A.length);
    });
    it('growth over the all-scope counts the whole company (positive control)', async () => {
        expect(total(await svc.growth(TENANT, 12, ALL_INSPECTIONS))).toBe(ALL_OF_TENANT.length);
    });
    it('growth for an inspector assigned to nothing is empty', async () => {
        expect(total(await svc.growth(TENANT, 12, { kind: 'assigned', userId: USERS.inspC }))).toBe(0);
    });
    it('findings read the results of visible inspections only', async () => {
        expect((await svc.findingsHeatmap(TENANT, A)).unresolved).toBe(1);
        expect((await svc.findingsHeatmap(TENANT, ALL_INSPECTIONS)).unresolved).toBe(2);
    });
    it('findings keep the date window and the scope together', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const inWindow = { from: today, to: today };
        expect((await svc.findingsHeatmap(TENANT, A, inWindow)).unresolved).toBe(1);
        expect((await svc.findingsHeatmap(TENANT, ALL_INSPECTIONS, inWindow)).unresolved).toBe(2);
        const past = { from: '2000-01-01', to: '2000-01-02' };
        expect((await svc.findingsHeatmap(TENANT, ALL_INSPECTIONS, past)).unresolved).toBe(0);
    });
});
