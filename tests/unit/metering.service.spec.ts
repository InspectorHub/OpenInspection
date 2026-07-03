import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from './db';
import { MeteringService, maybeMetering } from '../../server/services/metering.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('MeteringService', () => {
  let svc: MeteringService;
  beforeEach(async () => {
    const s = createTestDb();
    await setupSchema(s.sqlite);
    (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(s.db);
    svc = new MeteringService({} as any); // db arg unused — drizzle() is mocked to return the test db
  });
  it('record() inserts then increments the same bucket', async () => {
    await svc.record('t1', 'sms', '2026-06');
    await svc.record('t1', 'sms', '2026-06', 2);
    const row = (await svc.getAll()).find(r => r.tenantId === 't1' && r.metric === 'sms');
    expect(row?.value).toBe(3);
  });
  it('record() keeps periods separate', async () => {
    await svc.record('t1', 'email', '2026-05');
    await svc.record('t1', 'email', '2026-06');
    expect((await svc.getAll()).filter(r => r.metric === 'email')).toHaveLength(2);
  });
  it('setGauge() overwrites', async () => {
    await svc.setGauge('t1', 'r2_bytes', 'lifetime', 1000);
    await svc.setGauge('t1', 'r2_bytes', 'lifetime', 250);
    expect((await svc.getAll()).find(r => r.metric === 'r2_bytes')?.value).toBe(250);
  });
  it('maybeMetering returns a service in both standalone and saas', () => {
    expect(maybeMetering({ APP_MODE: undefined, DB: {} as any })).toBeInstanceOf(MeteringService);
    expect(maybeMetering({ APP_MODE: 'standalone', DB: {} as any })).toBeInstanceOf(MeteringService);
    expect(maybeMetering({ APP_MODE: 'saas', DB: {} as any })).toBeInstanceOf(MeteringService);
  });
});

describe('MeteringService.lifetimeTotal', () => {
  let svc: MeteringService;
  beforeEach(async () => {
    const s = createTestDb();
    await setupSchema(s.sqlite);
    (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(s.db);
    svc = new MeteringService({} as any); // db arg unused — drizzle() is mocked to return the test db
  });

  it('sums a metric across all period rows for one tenant', async () => {
    await svc.record('t1', 'sms', '2026-06', 30);
    await svc.record('t1', 'sms', '2026-07', 15);
    await svc.record('t2', 'sms', '2026-07', 99);      // other tenant ignored
    await svc.record('t1', 'sms_byo', '2026-07', 40);  // other metric ignored
    expect(await svc.lifetimeTotal('t1', 'sms')).toBe(45);
  });

  it('returns 0 when no rows exist', async () => {
    expect(await svc.lifetimeTotal('t1', 'email')).toBe(0);
  });

  it('accepts the new metric values (inspections uses the lifetime period)', async () => {
    await svc.record('t1', 'inspections', 'lifetime', 1);
    await svc.record('t1', 'inspections', 'lifetime', 1);
    expect(await svc.lifetimeTotal('t1', 'inspections')).toBe(2);
  });
});
