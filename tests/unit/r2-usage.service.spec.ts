import { describe, it, expect, vi } from 'vitest';
import { R2UsageService } from '../../server/services/r2-usage.service';

function fakeBucket(byPrefix: Record<string, Array<{ key: string; size: number }>>) {
  return { list: vi.fn(async (o: { prefix: string }) => ({ objects: byPrefix[o.prefix] ?? [], truncated: false, cursor: undefined } as any)) };
}

describe('R2UsageService', () => {
  it('sums bytes across the three per-tenant prefixes', async () => {
    const bucket = fakeBucket({
      't1/': [{ key: 't1/i1/a.jpg', size: 100 }, { key: 't1/i2/b.jpg', size: 50 }],
      'tenants/t1/': [{ key: 'tenants/t1/agreements/x/signed.pdf', size: 300 }],
      'branding/t1/': [{ key: 'branding/t1/logo.png', size: 25 }],
    });
    const svc = new R2UsageService(bucket as any, { setGauge: vi.fn().mockResolvedValue(undefined) } as any);
    expect(await svc.measureTenant('t1')).toBe(475);
  });
  it('measureAll writes one gauge per tenant', async () => {
    const setGauge = vi.fn().mockResolvedValue(undefined);
    const svc = new R2UsageService(fakeBucket({ 't1/': [{ key: 't1/i/a', size: 10 }] }) as any, { setGauge } as any);
    await svc.measureAll(['t1']);
    expect(setGauge).toHaveBeenCalledWith('t1', 'r2_bytes', 'lifetime', 10);
  });
});
