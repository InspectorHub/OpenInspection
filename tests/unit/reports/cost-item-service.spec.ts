// tests/unit/reports/cost-item-service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostItemService } from '../../../server/services/cost-item.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const INSPECTION = '11111111-1111-1111-1111-1111111111c1';

describe('CostItemService', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let svc: CostItemService;

  beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    svc = new CostItemService({} as D1Database);
  });

  it('creates and lists items by inspection in sortOrder, tenant-scoped', async () => {
    await svc.create(TENANT, {
      inspectionId: INSPECTION, system: 'roof', component: 'membrane', location: 'wing A',
      action: 'replace', costMethod: 'unit', quantity: 5, uom: 'sf', unitCostCents: 120000,
      bucket: 'immediate', suggestedRemedy: 'Replace membrane', sortOrder: 2,
    });
    await svc.create(TENANT, {
      inspectionId: INSPECTION, system: 'mep', component: 'rtu', location: 'roof',
      findingKey: 'unit1:sec2:item3', action: 'replace', costMethod: 'lump_sum',
      lumpSumCents: 1850000, rul: 3, bucket: 'long_term', suggestedRemedy: 'Replace RTU-3', sortOrder: 1,
    });
    const items = await svc.listByInspection(INSPECTION, TENANT);
    expect(items.map((i) => i.component)).toEqual(['rtu', 'membrane']); // sortOrder 1 then 2
    expect(items[0]!.lumpSumCents).toBe(1850000);
    expect(items[1]!.quantity).toBe(5);

    const other = await svc.listByInspection(INSPECTION, 'tenant-other');
    expect(other).toEqual([]); // tenant scoping
  });
});
