import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialService } from '../../../server/services/credential.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';
const U = 'user-1';
const U2 = 'user-2';

describe('CredentialService', () => {
  let svc: CredentialService;
  let testDb: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    svc = new CredentialService({} as D1Database);
  });

  it('creates, lists in sort order, updates, deletes — scoped to (tenant, user)', async () => {
    const a = await svc.create(T, U, { label: 'InterNACHI CPI', sortOrder: 2 });
    const b = await svc.create(T, U, { label: 'TX License', memberNumber: '22841', sortOrder: 1 });

    let list = await svc.listByUser(T, U);
    expect(list.map((x) => x.label)).toEqual(['TX License', 'InterNACHI CPI']); // sortOrder asc

    await svc.update(b.id, T, U, { label: 'Texas License', memberNumber: '99999' });
    list = await svc.listByUser(T, U);
    expect(list.find((x) => x.id === b.id)?.label).toBe('Texas License');
    expect(list.find((x) => x.id === b.id)?.memberNumber).toBe('99999');

    await svc.delete(a.id, T, U);
    list = await svc.listByUser(T, U);
    expect(list.map((x) => x.label)).toEqual(['Texas License']);
  });

  it('never leaks across users of the same tenant', async () => {
    await svc.create(T, U, { label: 'Mine' });
    await svc.create(T, U2, { label: 'Theirs' });
    expect((await svc.listByUser(T, U)).map((x) => x.label)).toEqual(['Mine']);
    expect((await svc.listByUser(T, U2)).map((x) => x.label)).toEqual(['Theirs']);
  });

  it('update/delete on another tenant is a fail-closed no-op', async () => {
    const mine = await svc.create(T, U, { label: 'Mine' });
    // Same id, wrong tenant → update throws NotFound, delete is a silent no-op.
    await expect(svc.update(mine.id, T2, U, { label: 'Hijacked' })).rejects.toThrow();
    await svc.delete(mine.id, T2, U);
    expect((await svc.listByUser(T, U)).map((x) => x.label)).toEqual(['Mine']); // untouched
  });
});
