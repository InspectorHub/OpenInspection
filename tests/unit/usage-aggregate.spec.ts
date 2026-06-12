import { describe, it, expect } from 'vitest';
import { aggregateUsage } from '../../server/lib/usage/aggregate';
describe('aggregateUsage', () => {
  it('sums sms/email across periods and takes r2_bytes as a gauge', () => {
    const rows = [
      { tenantId: 't1', metric: 'sms' as const, periodKey: '2026-05', value: 2, updatedAt: new Date() },
      { tenantId: 't1', metric: 'sms' as const, periodKey: '2026-06', value: 3, updatedAt: new Date() },
      { tenantId: 't1', metric: 'email' as const, periodKey: '2026-06', value: 40, updatedAt: new Date() },
      { tenantId: 't1', metric: 'r2_bytes' as const, periodKey: 'lifetime', value: 2048, updatedAt: new Date() },
      { tenantId: 't2', metric: 'sms' as const, periodKey: '2026-06', value: 1, updatedAt: new Date() },
    ];
    const agg = aggregateUsage(rows);
    expect(agg.find(a => a.tenantId === 't1')).toMatchObject({ sms: 5, email: 40, r2Bytes: 2048 });
    expect(agg.find(a => a.tenantId === 't2')).toMatchObject({ sms: 1, email: 0, r2Bytes: 0 });
  });
});
