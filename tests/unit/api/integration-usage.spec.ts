/**
 * Free-tier usage quotas Task 7 — `GET /api/integration/usage` payload shape.
 * The M2M-guarded, saas-only endpoint the portal console reads to render a
 * platform-wide usage dashboard: per tenant, lifetime sums for every metered
 * dimension plus the tenant's plan tier and (free tier only) the caps those
 * platform metrics are measured against.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { MeteringService } from '../../../server/services/metering.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

describe('GET /api/integration/usage', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];
  let testD1: D1Database;

  function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/integration', integrationRoutes); return a; }
  async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

  beforeEach(async () => {
    const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    testD1 = toRawD1(sqlite);
    await testDb.insert(schema.tenants).values([
      { id: 't-free', name: 'Free Co', slug: 'free-co', tier: 'free', createdAt: new Date() },
      { id: 't-pro', name: 'Pro Co', slug: 'pro-co', tier: 'pro', createdAt: new Date() },
    ] as never);
  });
  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  it('403 without M2M header', async () => {
    const res = await app().request('/api/integration/usage', {}, ENV);
    expect(res.status).toBe(403);
  });

  it('returns per-tenant tier, lifetime sums, byo split, and caps-for-free', async () => {
    const m = new MeteringService(testD1);
    await m.record('t-free', 'inspections', 'lifetime', 3);
    await m.record('t-free', 'sms', '2026-06', 10);
    await m.record('t-free', 'email', '2026-06', 20);
    await m.record('t-free', 'sms_byo', '2026-06', 5);
    await m.record('t-free', 'email_byo', '2026-06', 7);
    await m.setGauge('t-free', 'r2_bytes', 'lifetime', 2048);

    await m.record('t-pro', 'inspections', 'lifetime', 40);
    await m.record('t-pro', 'sms', '2026-06', 500);
    await m.record('t-pro', 'email', '2026-06', 900);

    const res = await app().request('/api/integration/usage', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };

    const free = body.data.find((r) => r.tenantId === 't-free');
    expect(free).toEqual({
      tenantId: 't-free', tier: 'free',
      inspections: 3, sms: 10, smsByo: 5, email: 20, emailByo: 7, r2Bytes: 2048,
      caps: { inspections: 5, sms: 50, email: 50 },
    });

    const pro = body.data.find((r) => r.tenantId === 't-pro');
    expect(pro).toEqual({
      tenantId: 't-pro', tier: 'pro',
      inspections: 40, sms: 500, smsByo: 0, email: 900, emailByo: 0, r2Bytes: 0,
      caps: null,
    });
  });

  it('empty usage_counters -> empty data array', async () => {
    const res = await app().request('/api/integration/usage', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
