import { describe, it, expect } from 'vitest';
import { aggregateUsage, summariseTenantUsage } from '../../../server/lib/usage/aggregate';
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

describe('summariseTenantUsage', () => {
  it('summariseTenantUsage isolates one tenant and zero-fills', () => {
    const rows = [
      { tenantId: 't1', metric: 'sms', periodKey: '2026-05', value: 2, updatedAt: new Date() },
      { tenantId: 't1', metric: 'sms', periodKey: '2026-06', value: 3, updatedAt: new Date() },
      { tenantId: 't1', metric: 'email', periodKey: '2026-06', value: 3, updatedAt: new Date() },
      { tenantId: 't1', metric: 'r2_bytes', periodKey: 'lifetime', value: 1000, updatedAt: new Date() },
      { tenantId: 't2', metric: 'sms', periodKey: '2026-06', value: 99, updatedAt: new Date() },
    ] as any;
    expect(summariseTenantUsage(rows, 't1')).toEqual({
      tenantId: 't1', sms: 5, email: 3, smsByo: 0, emailByo: 0, inspections: 0, r2Bytes: 1000,
    });
    expect(summariseTenantUsage(rows, 'absent')).toEqual({
      tenantId: 'absent', sms: 0, email: 0, smsByo: 0, emailByo: 0, inspections: 0, r2Bytes: 0,
    });
  });

  it('sums inspections/sms_byo/email_byo lifetime totals per tenant', () => {
    const rows = [
      { tenantId: 't1', metric: 'inspections', periodKey: 'lifetime', value: 3, updatedAt: new Date() },
      { tenantId: 't1', metric: 'sms_byo', periodKey: '2026-06', value: 12, updatedAt: new Date() },
      { tenantId: 't1', metric: 'email_byo', periodKey: '2026-06', value: 7, updatedAt: new Date() },
      { tenantId: 't1', metric: 'email_byo', periodKey: '2026-07', value: 3, updatedAt: new Date() },
    ] as any;
    const agg = aggregateUsage(rows);
    expect(agg.find((a) => a.tenantId === 't1')).toMatchObject({
      inspections: 3, smsByo: 12, emailByo: 10,
    });
  });
});
