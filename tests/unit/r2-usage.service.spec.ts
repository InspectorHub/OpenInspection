import { describe, it, expect, vi } from 'vitest';
import { R2UsageService } from '../../server/services/r2-usage.service';

function fakeBucket(byPrefix: Record<string, Array<{ key: string; size: number }>>) {
  return { list: vi.fn(async (o: { prefix: string }) => ({ objects: byPrefix[o.prefix] ?? [], truncated: false, cursor: undefined } as any)) };
}

describe('R2UsageService', () => {
  it('sums all asset classes under the single {tenantId}/ prefix — including client documents', async () => {
    // All keys now live under the unified t1/ root (task-7 convention):
    //   t1/inspections/{id}/photos/     — inspection photos
    //   t1/inspections/{id}/documents/  — client documents (previously unmetered)
    //   t1/branding/                    — branding assets
    //   t1/inspector-photos/            — inspector profile photos
    const bucket = fakeBucket({
      't1/': [
        { key: 't1/inspections/i1/photos/a.jpg',     size: 100 },
        { key: 't1/inspections/i2/photos/b.jpg',     size:  50 },
        { key: 't1/inspections/i1/documents/doc.pdf', size: 200 }, // previously missed
        { key: 't1/branding/logo.png',                size:  25 },
        { key: 't1/inspector-photos/avatar.jpg',      size:  75 },
      ],
    });
    const svc = new R2UsageService(bucket as any, { setGauge: vi.fn().mockResolvedValue(undefined) } as any);
    // Total: 100 + 50 + 200 + 25 + 75 = 450
    expect(await svc.measureTenant('t1')).toBe(450);
  });

  it('measureAll writes one gauge per tenant', async () => {
    const setGauge = vi.fn().mockResolvedValue(undefined);
    const svc = new R2UsageService(fakeBucket({ 't1/': [{ key: 't1/i/a', size: 10 }] }) as any, { setGauge } as any);
    await svc.measureAll(['t1']);
    expect(setGauge).toHaveBeenCalledWith('t1', 'r2_bytes', 'lifetime', 10);
  });
});
