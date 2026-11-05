// tests/unit/compliance-state-store.spec.ts
import { describe, it, expect } from 'vitest';
import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { createTestDb, setupSchema } from '../db';
import { D1ComplianceStateStore } from '../../../server/lib/messaging/compliance-state-store';

describe('D1ComplianceStateStore', () => {
  it('init creates a not_started row; persist patches + stamps updatedAt; load reads it back', async () => {
    const fx = createTestDb(); await setupSchema(fx.sqlite);
    testD1.use(fx.db);
    const store = new D1ComplianceStateStore(testD1.binding);
    const created = await store.init('t1', 'twilio');
    expect(created.complianceStatus).toBe('not_started');
    expect(created.provider).toBe('twilio');
    await store.persist('t1', { brandSid: 'BN1', complianceStatus: 'brand_pending' });
    const row = await store.load('t1');
    expect(row?.brandSid).toBe('BN1');
    expect(row?.complianceStatus).toBe('brand_pending');
    fx.sqlite.close();
  });
});
