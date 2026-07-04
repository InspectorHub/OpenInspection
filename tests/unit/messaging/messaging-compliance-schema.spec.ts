import { describe, it, expect } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

describe('messaging_compliance table', () => {
  it('inserts + reads a row with default complianceStatus', async () => {
    const fx = createTestDb();
    await setupSchema(fx.sqlite);
    await fx.db.insert(schema.messagingCompliance).values({
      tenantId: 't1', mode: 'own', complianceStatus: 'not_started', createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const row = await fx.db.select().from(schema.messagingCompliance).get();
    expect(row?.tenantId).toBe('t1');
    expect(row?.complianceStatus).toBe('not_started');
    fx.sqlite.close();
  });

  it('messaging_compliance has messaging_resource_sid + provider_meta', async () => {
    const fx = createTestDb();
    await setupSchema(fx.sqlite);
    await fx.db.insert(schema.messagingCompliance).values({
      tenantId: 't1', provider: 'telnyx', mode: 'managed_dedicated', complianceStatus: 'not_started',
      messagingResourceSid: 'MP1', providerMeta: '{"vettingId":"v1"}', createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const row = await fx.db.select().from(schema.messagingCompliance).get();
    expect(row?.messagingResourceSid).toBe('MP1');
    expect(row?.providerMeta).toBe('{"vettingId":"v1"}');
    fx.sqlite.close();
  });
});
