import { describe, it, expect } from 'vitest';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';

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
});
