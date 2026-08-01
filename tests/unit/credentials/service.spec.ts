import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialService } from '../../../server/services/credential.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

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

/**
 * `listRenderable` — the one mapping every surface uses.
 *
 * There were three hand-written copies of these six lines when this was
 * extracted (booking's email footer, the Profile signature preview, and the
 * report payload about to become a fourth). Three copies is how the badge URL
 * comes to differ between the email a client receives and the page they land
 * on, and the difference is invisible from either side.
 */
describe('CredentialService.listRenderable', () => {
  let svc: CredentialService;
  let testDb: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    svc = new CredentialService({} as D1Database);
  });

  it('emits the public brand-asset path, url-encoded, in the inspector own order', async () => {
    const a = await svc.create(T, U, { label: 'InterNACHI CPI', memberNumber: 'NACHI-1', sortOrder: 2 });
    await svc.create(T, U, { label: 'TX License', memberNumber: '22841', sortOrder: 1 });
    await testDb.update(schema.inspectorCredentials)
      .set({ imageR2Key: 't1/credentials/logo one.png' })
      .where(eq(schema.inspectorCredentials.id, a.id));

    const out = await svc.listRenderable(T, U);
    expect(out.map((c) => c.label)).toEqual(['TX License', 'InterNACHI CPI']);
    expect(out[0].imageUrl).toBeNull();
    // Encoded, because the key contains a space and a slash and this string is
    // pasted straight into an href/src by four different renderers.
    expect(out[1].imageUrl).toBe('/api/public/brand-asset?key=t1%2Fcredentials%2Flogo%20one.png');
  });

  it('drops inactive credentials', async () => {
    const a = await svc.create(T, U, { label: 'Retired cert' });
    await svc.create(T, U, { label: 'Live cert' });
    await testDb.update(schema.inspectorCredentials)
      .set({ active: false })
      .where(eq(schema.inspectorCredentials.id, a.id));

    expect((await svc.listRenderable(T, U)).map((c) => c.label)).toEqual(['Live cert']);
  });

  it('drops a row that is neither a badge nor a label', async () => {
    // A credential row is created BLANK and filled in, so an abandoned one
    // would otherwise render as an empty chip on the cover of a report.
    await svc.create(T, U, { label: '' });
    await svc.create(T, U, { label: '   ' });
    await svc.create(T, U, { label: 'Real one' });
    expect((await svc.listRenderable(T, U)).map((c) => c.label)).toEqual(['Real one']);
  });

  it('never crosses a tenant or a user', async () => {
    await svc.create(T, U, { label: 'Mine' });
    await svc.create(T2, U, { label: 'Other tenant' });
    await svc.create(T, U2, { label: 'Other user' });
    expect((await svc.listRenderable(T, U)).map((c) => c.label)).toEqual(['Mine']);
  });
});

/**
 * `primaryLicenseNumber` — the one string the surfaces that cannot show a list
 * are allowed to print.
 *
 * The PDF footer prints `· Lic. <n>` and the report signature block carries a
 * single licence. A dedicated `users` column used to answer this and is gone,
 * so the answer comes from the credential the backfill seeded at
 * `sort_order = -1` — which is precisely why that sort order was chosen instead
 * of 0, and why this rule can be stated as "first active credential carrying a
 * member number, in the inspector own order".
 */
describe('CredentialService.primaryLicenseNumber', () => {
  let svc: CredentialService;
  let testDb: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    svc = new CredentialService({} as D1Database);
  });

  it('returns the licence, not a voluntary badge that happens to sort first', async () => {
    await svc.create(T, U, { label: 'InterNACHI CPI', memberNumber: 'N-1', sortOrder: 0 });
    await svc.create(T, U, { label: 'Licensed home inspector', memberNumber: 'TX-9001', sortOrder: -1 });
    expect(await svc.primaryLicenseNumber(T, U)).toBe('TX-9001');
  });

  it('skips credentials with no member number — a badge image is not a licence', async () => {
    await svc.create(T, U, { label: 'Association logo', sortOrder: -2 });
    await svc.create(T, U, { label: 'Licensed home inspector', memberNumber: 'TX-9001', sortOrder: -1 });
    expect(await svc.primaryLicenseNumber(T, U)).toBe('TX-9001');
  });

  it('skips an inactive licence', async () => {
    const a = await svc.create(T, U, { label: 'Old licence', memberNumber: 'TX-OLD', sortOrder: -1 });
    await testDb.update(schema.inspectorCredentials).set({ active: false })
      .where(eq(schema.inspectorCredentials.id, a.id));
    await svc.create(T, U, { label: 'Current licence', memberNumber: 'TX-NEW', sortOrder: 0 });
    expect(await svc.primaryLicenseNumber(T, U)).toBe('TX-NEW');
  });

  it('returns null when there is nothing to print', async () => {
    // The callers omit the line rather than printing an empty one.
    expect(await svc.primaryLicenseNumber(T, U)).toBeNull();
    await svc.create(T, U, { label: 'Badge only' });
    expect(await svc.primaryLicenseNumber(T, U)).toBeNull();
  });

  it('never reads another user licence', async () => {
    await svc.create(T, U2, { label: 'Licensed home inspector', memberNumber: 'NOT-MINE', sortOrder: -1 });
    expect(await svc.primaryLicenseNumber(T, U)).toBeNull();
  });
});
