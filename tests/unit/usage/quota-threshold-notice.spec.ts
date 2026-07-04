/**
 * Free-tier usage quotas (2026-07), Task 8 — `EmailBaseService.sendQuotaThresholdNotice`.
 *
 * Covers the parts `noticeFor` (pure-function spec) doesn't reach:
 *  - the tenant-owner recipient lookup,
 *  - the 4-vs-5 copy branch,
 *  - the KV dedup key (`quota-notice:{tenantId}:{n}`) so a retry never
 *    double-sends,
 *  - and — the safety-critical property from the brief — that this send
 *    NEVER records against the tenant's own `email`/`email_byo` metering
 *    counter, because the caller assembles the EmailService WITHOUT a
 *    `meterTenantId` (see build-email-service.ts: `meter`/`quota` are both
 *    gated on that argument).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

// `sendQuotaThresholdNotice` dynamically imports `drizzle-orm/d1` at call
// time (mirrors sendMessageNotification's own DB-lookup style in the same
// file) — mock it the same way plan-quota.spec.ts / email-quota.spec.ts do,
// so both the static and dynamic imports resolve to the in-memory SQLite
// Drizzle instance.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { assembleTenantEmailService, type EmailServiceEnv } from '../../../server/lib/email/build-email-service';
import { MeteringService } from '../../../server/services/metering.service';

const baseEnv: EmailServiceEnv = {
  DB: {} as never,
  TENANT_CACHE: {} as never,
  JWT_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_platform',
  SENDER_EMAIL: 'platform@example.com',
};

/** Minimal in-memory KVNamespace stand-in — enough for get/put dedup checks. */
function makeFakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
  } as unknown as KVNamespace;
}

describe('sendQuotaThresholdNotice', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testDb: BetterSQLite3Database<typeof schema>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sqlite: any;
  let testD1: D1Database;

  beforeEach(async () => {
    const setup = createTestDb();
    testDb = setup.db;
    sqlite = setup.sqlite;
    await setupSchema(sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    testD1 = toRawD1(sqlite);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function seedOwner(tenantId: string, email: string) {
    await testDb.insert(schema.tenants).values({
      id: tenantId, name: 'Acme', slug: tenantId, tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
      id: `${tenantId}-owner`, tenantId, email, passwordHash: 'x', role: 'owner', createdAt: new Date(),
    });
  }

  it('emails the tenant owner with the 4/5 "one left" copy', async () => {
    await seedOwner('tenant-4', 'owner4@example.com');
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };
    const svc = assembleTenantEmailService(env, { dbSecrets: {} });

    await svc.sendQuotaThresholdNotice(4, { db: testD1, tenantId: 'tenant-4', billingPortalUrl: 'https://billing.example.com' });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(['owner4@example.com']);
    expect(body.subject).toBe('One free inspection left');
    expect(body.html).toContain('one free inspection left');
  });

  it('emails the tenant owner with the 5/5 "cap reached" copy', async () => {
    await seedOwner('tenant-5', 'owner5@example.com');
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };
    const svc = assembleTenantEmailService(env, { dbSecrets: {} });

    await svc.sendQuotaThresholdNotice(5, { db: testD1, tenantId: 'tenant-5', billingPortalUrl: null });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.subject).toBe("You've used your 5 free inspections");
    expect(body.html).toContain('subscribe to create new ones');
  });

  it('never records against the tenant email metering counter (unmetered by construction)', async () => {
    await seedOwner('tenant-unmetered', 'owner@example.com');
    const record = vi.spyOn(MeteringService.prototype, 'record').mockResolvedValue(undefined);
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };
    // Deliberately built WITHOUT a meterTenantId — the exact instance shape
    // the core.ts call site uses for this send.
    const svc = assembleTenantEmailService(env, { dbSecrets: {} });

    await svc.sendQuotaThresholdNotice(4, { db: testD1, tenantId: 'tenant-unmetered', billingPortalUrl: null });

    expect(record).not.toHaveBeenCalled();
  });

  it('dedupes via KV — a second call for the same (tenantId, n) does not send again', async () => {
    await seedOwner('tenant-dedupe', 'owner@example.com');
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };
    const svc = assembleTenantEmailService(env, { dbSecrets: {} });
    const kv = makeFakeKv();

    await svc.sendQuotaThresholdNotice(5, { db: testD1, kv, tenantId: 'tenant-dedupe', billingPortalUrl: null });
    await svc.sendQuotaThresholdNotice(5, { db: testD1, kv, tenantId: 'tenant-dedupe', billingPortalUrl: null });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the tenant has no owner row', async () => {
    // No seedOwner call — tenant has no users row at all.
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };
    const svc = assembleTenantEmailService(env, { dbSecrets: {} });

    await expect(svc.sendQuotaThresholdNotice(4, { db: testD1, tenantId: 'tenant-no-owner', billingPortalUrl: null })).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('is a no-op when the only owner row is soft-deleted (Fix 5)', async () => {
    const { eq } = await import('drizzle-orm');
    await seedOwner('tenant-deleted-owner', 'gone@example.com');
    // Soft-delete the owner we just seeded — a removed/self-deleted owner
    // must never receive a quota notice.
    await testDb.update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.email, 'gone@example.com'));

    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };
    const svc = assembleTenantEmailService(env, { dbSecrets: {} });

    await expect(svc.sendQuotaThresholdNotice(4, { db: testD1, tenantId: 'tenant-deleted-owner', billingPortalUrl: null })).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
