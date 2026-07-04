// tests/unit/compliance-state-store.spec.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { D1ComplianceStateStore } from '../../../server/lib/messaging/compliance-state-store';

describe('D1ComplianceStateStore', () => {
  it('init creates a not_started row; persist patches + stamps updatedAt; load reads it back', async () => {
    const fx = createTestDb(); await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
    const store = new D1ComplianceStateStore({} as D1Database);
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
