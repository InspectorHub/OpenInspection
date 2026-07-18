import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { eq } from 'drizzle-orm';

describe('seedRoleProfiles', () => {
  let fixture: ReturnType<typeof createTestDb>;
  beforeEach(async () => { fixture = createTestDb(); await setupSchema(fixture.sqlite); });

  it('seeds the 8 defaults and is idempotent', async () => {
    await seedRoleProfiles(fixture.db as any, 't1', new Date(1));
    await seedRoleProfiles(fixture.db as any, 't1', new Date(2)); // second run must not duplicate
    const rows = await fixture.db.select().from(schema.contactRoleProfiles)
      .where(eq(schema.contactRoleProfiles.tenantId, 't1'));
    expect(rows).toHaveLength(8);
    expect(rows.filter(r => r.kind === 'client').map(r => r.key).sort()).toEqual(['client', 'co_client']);
  });
});
