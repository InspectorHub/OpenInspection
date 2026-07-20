import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

describe('role-profile schema tables', () => {
  let fixture: ReturnType<typeof createTestDb>;
  beforeEach(async () => { fixture = createTestDb(); await setupSchema(fixture.sqlite); });

  it('accepts a role profile and an inspection_people row', async () => {
    await fixture.db.insert(schema.contactRoleProfiles).values({
      id: 'rp1', tenantId: 't1', key: 'client', label: 'Client', kind: 'client',
      isSystem: true, sortOrder: 0, active: true, createdAt: new Date(1), updatedAt: new Date(1),
    });
    await fixture.db.insert(schema.inspectionPeople).values({
      id: 'ip1', tenantId: 't1', inspectionId: 'i1', contactId: 'c1', roleProfileId: 'rp1', createdAt: new Date(1),
    });
    const rows = await fixture.db.select().from(schema.inspectionPeople);
    expect(rows).toHaveLength(1);
    expect(rows[0].roleProfileId).toBe('rp1');
  });
});
