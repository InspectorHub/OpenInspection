/**
 * `createInspection` hands the allowance back from inside the catch block of
 * its insert. If handing it back threw, that error replaced the insert's, so a
 * replayed offline create answered 500 instead of the existing inspection, and a
 * genuine id collision lost its 409. The give-back must never mask what it was
 * called to clean up after.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { InspectionService } from '../../../server/services/inspection.service';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { MeteringService } from '../../../server/services/metering.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { logger } from '../../../server/lib/logger';

const TENANT = 't1';
const OTHER = 't2';
const ID = 'client-chosen-id';

describe('releasing an inspection allowance never masks the insert error', () => {
    let testDb: ReturnType<typeof createTestDb>['db'];
    let testD1: D1Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        testD1 = toRawD1(fixture.sqlite);
        for (const id of [TENANT, OTHER]) {
            await testDb.insert(schema.tenants).values({
                id, slug: id, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
    });
    afterEach(() => vi.restoreAllMocks());

    const serviceFor = (tenant: string) => new InspectionService(
        {} as D1Database, undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new ScopedDB(testDb as any, tenant), undefined, undefined,
        new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (): any => ({ id: ID, propertyAddress: '1 Main St', clientName: 'Client' });

    it('a replay of the same create still answers with the existing inspection when the give-back fails', async () => {
        const first = await serviceFor(TENANT).createInspection(TENANT, data());
        const warn = vi.spyOn(logger, 'warn');
        // Control: with a working give-back the replay answers with the existing inspection.
        const replay = await serviceFor(TENANT).createInspection(TENANT, data());
        expect(replay).toMatchObject({ id: first.id });
        expect(warn).not.toHaveBeenCalled();

        vi.spyOn(MeteringService.prototype, 'setGauge').mockRejectedValue(new Error('counter write failed'));
        const again = await serviceFor(TENANT).createInspection(TENANT, data());
        expect(again).toMatchObject({ id: first.id });
        expect(warn).toHaveBeenCalledWith('Could not give back an inspection allowance', expect.objectContaining({ tenantId: TENANT, error: 'counter write failed' }));
    });

    it('an id held by another workspace is still a 409 ID_CONFLICT when the give-back fails', async () => {
        await serviceFor(OTHER).createInspection(OTHER, data());
        vi.spyOn(MeteringService.prototype, 'setGauge').mockRejectedValue(new Error('counter write failed'));
        await expect(serviceFor(TENANT).createInspection(TENANT, data())).rejects.toMatchObject({ status: 409, code: 'ID_CONFLICT' });
    });
});
