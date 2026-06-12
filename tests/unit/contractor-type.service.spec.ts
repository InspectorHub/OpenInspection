import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContractorTypeService } from '../../server/services/contractor-type.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = '00000000-0000-0000-0000-000000000001';

describe('ContractorTypeService', () => {
  let svc: ContractorTypeService;
  let testDb: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
    await testDb.insert(schema.tenants).values({ id: T, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, appliedCmdSeq: 0, appliedCredSeq: 0, createdAt: new Date() });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    svc = new ContractorTypeService({} as D1Database);
  });

  it('creates, lists in sort order, updates, reorders, deletes — tenant-scoped', async () => {
    const a = await svc.create(T, { name: 'Plumber', sortOrder: 2 });
    const b = await svc.create(T, { name: 'Electrician', sortOrder: 1 });
    let list = await svc.listByTenant(T);
    expect(list.map(x => x.name)).toEqual(['Electrician', 'Plumber']);

    await svc.update(b.id, T, { name: 'Licensed Electrician' });
    await svc.reorder(T, [a.id, b.id]);
    list = await svc.listByTenant(T);
    expect(list.map(x => x.name)).toEqual(['Plumber', 'Licensed Electrician']);

    await svc.delete(a.id, T);
    list = await svc.listByTenant(T);
    expect(list.map(x => x.name)).toEqual(['Licensed Electrician']);
  });
});
