/**
 * What a Free-plan company is told when it texts, by SMS mode. The Free plan has no allowance of
 * text messages on a platform-provided number; the refusal must reach only the modes that would use one,
 * and must never pre-empt the answer that is true for the company's own mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { smsSendGate } from '../../../server/lib/sms/send-gate';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { Errors } from '../../../server/lib/errors';

const TENANT = 't-free-sms';
let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({ id: TENANT, slug: TENANT, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() } as never);
});
afterEach(() => sqlite.close());

const guardFor = () => {
    const guard = new PlanQuotaGuard({} as never, { enforced: true, billingPortalUrl: null });
    const check = vi.spyOn(guard, 'checkMessagingQuota').mockImplementation(async () => { throw Errors.PlatformSmsNotInPlan({ billingPortalUrl: null }); });
    return { guard, check };
};
const gate = (guard: PlanQuotaGuard, env: Record<string, unknown> = { APP_MODE: 'saas' }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    smsSendGate({ db: db as any, tenantId: TENANT, to: '+15558887766', purpose: 'test', bodyTemplate: '', env: env as never, quota: { guard, tier: 'free' } });

describe('Free plan texting, by SMS mode (hosted deployment)', () => {
    it('a company that never chose a mode (default platform) is refused quietly as "not configured", not with the plan refusal', async () => {
        const { guard, check } = guardFor();
        expect(await gate(guard)).toEqual({ allowed: false, reason: 'sms not configured' });
        expect(check).not.toHaveBeenCalled();
    });

    it('a registered-number company that is not yet approved is told so, before any plan question', async () => {
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, smsMode: 'managed_dedicated', updatedAt: new Date() } as never);
        const { guard, check } = guardFor();
        expect(await gate(guard)).toEqual({ allowed: false, reason: 'managed_not_approved' });
        expect(check).not.toHaveBeenCalled();
    });

    it('control: an approved registered-number company on the Free plan reaches the plan refusal, which carries the sms metric', async () => {
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, smsMode: 'managed_dedicated', updatedAt: new Date() } as never);
        await db.insert(schema.messagingCompliance).values({ tenantId: TENANT, complianceStatus: 'approved', createdAt: new Date(), updatedAt: new Date() } as never);
        const { guard, check } = guardFor();
        await expect(gate(guard)).rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED', details: { metric: 'sms' } });
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('control: a deployment that enforces no plans (self-hosted) does not refuse a Free-tier text', async () => {
        const guard = new PlanQuotaGuard({} as never, { enforced: false, billingPortalUrl: null });
        expect((await gate(guard, { APP_MODE: 'standalone' })).allowed).toBe(true);
    });
});
