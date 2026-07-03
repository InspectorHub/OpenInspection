/**
 * Free-tier usage quotas Task 8b — `GET /api/integration/tenants/:slug/seat-usage`.
 * M2M-guarded, saas-only read the portal uses for reverse seat-sync: reconcile
 * a tenant's Stripe seat quantity against the ACTUAL count of active
 * (non-soft-deleted) members rather than trusting portal's last-written value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

describe('GET /api/integration/tenants/:slug/seat-usage', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/integration', integrationRoutes); return a; }
  async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

  beforeEach(async () => {
    const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    await testDb.insert(schema.tenants).values([
      { id: 't-a', name: 'Tenant A', slug: 'tenant-a', tier: 'free', maxUsers: 5, createdAt: new Date() },
    ] as never);
  });
  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  it('403 without M2M header', async () => {
    const res = await app().request('/api/integration/tenants/tenant-a/seat-usage', {}, ENV);
    expect(res.status).toBe(403);
  });

  it('404 for unknown slug', async () => {
    const res = await app().request(
      '/api/integration/tenants/no-such-tenant/seat-usage',
      { headers: { [M2M_HEADER]: await header() } },
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it('returns {used, max} matching active (non-soft-deleted) member count', async () => {
    await testDb.insert(schema.users).values([
      { id: 'u1', tenantId: 't-a', email: 'u1@example.com', passwordHash: 'x', role: 'inspector', createdAt: new Date() },
      { id: 'u2', tenantId: 't-a', email: 'u2@example.com', passwordHash: 'x', role: 'inspector', createdAt: new Date() },
      // Soft-deleted member: must NOT count toward `used` (Task 8a).
      {
        id: 'u3', tenantId: 't-a', email: 'u3@example.com', passwordHash: 'x', role: 'inspector',
        createdAt: new Date(), deletedAt: new Date(),
      },
    ] as never);

    const res = await app().request(
      '/api/integration/tenants/tenant-a/seat-usage',
      { headers: { [M2M_HEADER]: await header() } },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { used: number; max: number | null } };
    expect(body).toEqual({ success: true, data: { used: 2, max: 5 } });
  });

  it('max is null when maxUsers is the unlimited sentinel (0)', async () => {
    await testDb.insert(schema.tenants).values([
      { id: 't-b', name: 'Tenant B', slug: 'tenant-b', tier: 'pro', maxUsers: 0, createdAt: new Date() },
    ] as never);

    const res = await app().request(
      '/api/integration/tenants/tenant-b/seat-usage',
      { headers: { [M2M_HEADER]: await header() } },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { used: number; max: number | null } };
    expect(body.data).toEqual({ used: 0, max: null });
  });
});

import workerEntry from '../../../workers/app';
describe('GET /api/integration/tenants/:slug/seat-usage — standalone gate', () => {
  it('404s in standalone APP_MODE (route family is saas-only)', async () => {
    const req = new Request('https://x/api/integration/tenants/tenant-a/seat-usage');
    const res = await workerEntry.fetch(req, { APP_MODE: 'standalone' } as never, {} as never);
    expect(res.status).toBe(404);
  });
});
