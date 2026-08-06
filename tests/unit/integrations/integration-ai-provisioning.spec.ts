/**
 * Managed-AI provider tier, Task 5 follow-up (a) — `GET /api/integration/
 * ai-provisioning`. The M2M-guarded endpoint portal's tier-quota console reads
 * to answer "how many tenants per tier are managed / BYO / unconfigured".
 *
 * The buckets must come from the SAME `resolveAi` resolver the runtime uses
 * (via `resolveRuntimeAiSource`), not a re-derivation: if the console says
 * "byo", it must be because the resolver would run that tenant's call on its
 * own key. With managed entitlement still a literal `false`, the managed
 * bucket is 0 everywhere — asserted, because faking a nonzero count would be
 * the console lying about a path that cannot resolve yet.
 *
 * Wire contract pinned by portal's `narrowAiProvisioning`
 * (apps/portal server/services/tier-quota.service.ts): `{ tiers: { <tier>:
 * { managed, byo, unconfigured } } }`, all three numbers finite, and a tier
 * with NO tenants ABSENT rather than zeroed (absent = "core did not mention
 * it", which portal renders differently from a zero row).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// Partial mock: the router also imports `secretsCacheKey` from this module.
vi.mock('../../../server/lib/secrets-cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantSecrets: vi.fn(async () => null),
}));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { loadTenantSecrets } from '../../../server/lib/secrets-cache';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = {
  DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM,
  APP_MODE: 'saas', JWT_SECRET: 'test-secret',
  AI_MANAGED_API_KEY: 'platform-key', AI_MODEL: 'gemini-test',
} as Record<string, unknown>;

type TierCounts = { managed: number; byo: number; unconfigured: number };

describe('GET /api/integration/ai-provisioning', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/integration', integrationRoutes); return a; }
  async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

  beforeEach(async () => {
    const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    vi.mocked(loadTenantSecrets).mockReset().mockResolvedValue(null);
  });
  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  it('403 without M2M header', async () => {
    const res = await app().request('/api/integration/ai-provisioning', {}, ENV);
    expect(res.status).toBe(403);
  });

  it('buckets tenants per tier by the runtime resolver; absent tier stays absent; managed is 0 while entitlement is off', async () => {
    await testDb.insert(schema.tenants).values([
      { id: 't-free-nokey', name: 'F1', slug: 'f1', tier: 'free', createdAt: new Date() },
      { id: 't-free-key', name: 'F2', slug: 'f2', tier: 'free', createdAt: new Date() },
      { id: 't-pro-key', name: 'P1', slug: 'p1', tier: 'pro', createdAt: new Date() },
      { id: 't-pro-nokey', name: 'P2', slug: 'p2', tier: 'pro', createdAt: new Date() },
    ] as never);
    vi.mocked(loadTenantSecrets).mockImplementation(async (_db, _kv, tenantId) =>
      tenantId === 't-free-key' || tenantId === 't-pro-key' ? { GEMINI_API_KEY: 'tenant-own-key' } : null);

    const res = await app().request('/api/integration/ai-provisioning', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { tiers: Record<string, TierCounts> } };

    // AI_MANAGED_API_KEY is configured in ENV, yet managed stays 0: the
    // entitlement is a literal `false` until granted as configuration. A
    // nonzero managed count here would mean a SECOND resolution path invented
    // an entitlement the runtime does not have.
    expect(body.data.tiers).toEqual({
      free: { managed: 0, byo: 1, unconfigured: 1 },
      pro: { managed: 0, byo: 1, unconfigured: 1 },
    });
    expect(body.data.tiers).not.toHaveProperty('enterprise');
  });

  it('a tenant whose secrets blob cannot be decrypted counts as unconfigured — the same shape the runtime resolves it to', async () => {
    await testDb.insert(schema.tenants).values([
      { id: 't-broken', name: 'B', slug: 'b', tier: 'free', createdAt: new Date() },
    ] as never);
    vi.mocked(loadTenantSecrets).mockRejectedValue(new Error('undecryptable'));

    const res = await app().request('/api/integration/ai-provisioning', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { tiers: Record<string, TierCounts> } };
    expect(body.data.tiers).toEqual({ free: { managed: 0, byo: 0, unconfigured: 1 } });
  });

  it('no tenants at all -> empty tiers map, not an error', async () => {
    const res = await app().request('/api/integration/ai-provisioning', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { tiers: Record<string, unknown> } };
    expect(body.data.tiers).toEqual({});
  });
});
