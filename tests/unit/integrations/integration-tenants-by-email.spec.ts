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
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

describe('GET /api/integration/tenants/by-email', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/integration', integrationRoutes); return a; }
  async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

  beforeEach(async () => {
    const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    await testDb.insert(schema.tenants).values([
      { id: 't1', name: 'Acme', slug: 'acme', createdAt: new Date() },
      { id: 't2', name: 'Beta', slug: 'beta', createdAt: new Date() },
    ] as never);
    // The discovery query now joins each grant's role key against its OWN
    // tenant's active role profiles and gates on the selfRetrieveReport
    // capability (client/co_client by default), not a hard-coded literal list.
    await seedRoleProfiles(testDb, 't1', new Date(1));
    await seedRoleProfiles(testDb, 't2', new Date(1));
    await testDb.insert(schema.inspectionAccessTokens).values([
      { id: 'g1', tenantId: 't1', inspectionId: 'i1', recipientEmail: 'jane@x.com', role: 'client', token: 'tok1', createdAt: new Date() },
      { id: 'g2', tenantId: 't2', inspectionId: 'i2', recipientEmail: 'jane@x.com', role: 'co_client', token: 'tok2', createdAt: new Date(), revokedAt: new Date() }, // revoked → excluded
    ] as never);
  });
  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  it('403 without M2M header', async () => {
    const res = await app().request('/api/integration/tenants/by-email?email=jane@x.com', {}, ENV);
    expect(res.status).toBe(403);
  });
  it('returns only tenants with a LIVE grant', async () => {
    const res = await app().request('/api/integration/tenants/by-email?email=jane@x.com', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { slugs: string[] } };
    expect(body.data.slugs).toEqual(['acme']); // t2 grant revoked
  });
  it('400 on missing email', async () => {
    const res = await app().request('/api/integration/tenants/by-email', { headers: { [M2M_HEADER]: await header() } }, ENV);
    expect(res.status).toBe(400);
  });
});
