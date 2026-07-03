/**
 * Free-tier usage-quota spec (2026-07), Task 4 — email source tagging +
 * free-cap pre-flight.
 *
 *  - `assembleTenantEmailService` tags the meter 'email_byo' for a resolved
 *    own-mode (BYO) send and 'email' for a platform-mode send.
 *  - The pre-flight quota gate (`EmailBaseService.sendEmail` -> `quota.preflight()`)
 *    blocks a free tenant already at the 50 lifetime platform-email cap with a
 *    402 QUOTA_EXHAUSTED, BEFORE any provider request and BEFORE any meter record.
 *  - BYO sends are uncapped even when the platform `email` counter is at 50 —
 *    quota is only wired for platform-mode sends (see FREE_TIER_CAPS).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from './db';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

// Mock drizzle-orm/d1 so MeteringService's `drizzle(d1)` calls (used by
// PlanQuotaGuard.checkMessagingQuota's lifetimeTotal read) resolve against
// the in-memory SQLite-backed Drizzle instance — mirrors tests/unit/plan-quota.spec.ts.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
  assembleTenantEmailService,
  type LoadedEmailConfig,
  type EmailServiceEnv,
} from '../../server/lib/email/build-email-service';
import { MeteringService } from '../../server/services/metering.service';
import { PlanQuotaGuard } from '../../server/features/plan-quota/guard';

const baseEnv: EmailServiceEnv = {
  DB: {} as never,
  TENANT_CACHE: {} as never,
  JWT_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_platform',
  SENDER_EMAIL: 'platform@example.com',
};

const ownCfg: LoadedEmailConfig = {
  emailIdentity: {
    mode: 'own',
    senderEmail: 'hello@company.com',
    replyTo: null,
    senderDisplayName: null,
    pointOfContact: 'company',
    companyName: null,
  },
  emailBrand: undefined,
  dbSecrets: { resendApiKey: 'own_re_key' },
};

const platformCfg: LoadedEmailConfig = {
  emailIdentity: {
    mode: 'platform',
    senderEmail: null,
    replyTo: null,
    senderDisplayName: null,
    pointOfContact: 'company',
    companyName: null,
  },
  emailBrand: undefined,
  dbSecrets: {},
};

describe('email source tagging (email_byo vs email)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tags byo sends as email_byo and platform sends as email', async () => {
    const record = vi.spyOn(MeteringService.prototype, 'record').mockResolvedValue(undefined);

    const byoSvc = assembleTenantEmailService(baseEnv, ownCfg, 'tenant-byo');
    await byoSvc.sendEmail(['recipient@test.com'], 'Subj', '<p>hi</p>');

    const platformSvc = assembleTenantEmailService(baseEnv, platformCfg, 'tenant-platform');
    await platformSvc.sendEmail(['recipient@test.com'], 'Subj', '<p>hi</p>');

    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][1]).toBe('email_byo');
    expect(record.mock.calls[1][1]).toBe('email');
  });
});

describe('free-tier pre-flight cap (platform-mode only)', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let sqlite: any;
  let testD1: D1Database;

  beforeEach(async () => {
    const setup = createTestDb();
    testDb = setup.db;
    sqlite = setup.sqlite;
    await setupSchema(sqlite);
    (mockDrizzle as any).mockReturnValue(testDb);
    testD1 = toRawD1(sqlite);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('free tenant at 50 lifetime platform emails: sendEmail rejects 402 and provider fetch is not called', async () => {
    const m = new MeteringService(testD1);
    await m.record('tenant-free', 'email', '2026-06', 50);
    const record = vi.spyOn(MeteringService.prototype, 'record');
    const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };

    const svc = assembleTenantEmailService(env, platformCfg, 'tenant-free', guard, 'free');

    await expect(svc.sendEmail(['recipient@test.com'], 'Subj', '<p>hi</p>')).rejects.toMatchObject({
      status: 402,
      code: 'QUOTA_EXHAUSTED',
    });

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('byo config bypasses the cap even at 50', async () => {
    const m = new MeteringService(testD1);
    await m.record('tenant-free-byo', 'email', '2026-06', 50);
    const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
    const env: EmailServiceEnv = { ...baseEnv, DB: testD1 };

    const svc = assembleTenantEmailService(env, ownCfg, 'tenant-free-byo', guard, 'free');

    const result = await svc.sendEmail(['recipient@test.com'], 'Subj', '<p>hi</p>');

    expect(result).toEqual({ delivered: true });
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });
});
