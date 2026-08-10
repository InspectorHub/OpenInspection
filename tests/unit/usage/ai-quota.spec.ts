import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIService } from '../../../server/services/ai.service';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { FREE_TIER_CAPS } from '../../../server/features/plan-quota/policy';
import { MeteringService } from '../../../server/services/metering.service';
import { aiUsageMetric } from '../../../server/lib/usage/period';
import { resolveAi } from '../../../server/lib/ai/resolve-provider';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

/**
 * Managed-AI metering and its (currently unconfigured) enforcement path.
 *
 * The load-bearing risk here is a false green: with no cap configured, every
 * `checkAiQuota` call resolves, so a suite that only asserts "resolves" would
 * pass just as happily against a guard that cannot read the meter at all.
 * Each no-block assertion below is therefore paired with a configured-cap case
 * proving the guard DOES see the counter it claims to be ignoring.
 */
describe('AI quota + metering', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let testD1: D1Database;
    const T = 'tenant-ai';

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        (mockDrizzle as never as { mockReturnValue: (v: unknown) => void }).mockReturnValue(testDb);
        testD1 = toRawD1(setup.sqlite);
    });

    /** Seed in an ADVERSE order — the metric under test written last, and
     *  interleaved across period buckets — so no assertion can pass by reading
     *  whichever row happens to come back first. */
    async function seedAdversely(m: MeteringService) {
        await m.record(T, 'ai_translate_byo', '2026-06', 9_000);
        await m.record(T, 'ai_assist', '2026-07', 7_000);
        await m.record(T, 'ai_assist_byo', '2026-06', 8_000);
        await m.record(T, 'ai_translate', '2026-05', 4_000);
        await m.record(T, 'ai_translate', '2026-07', 6_000);
    }

    describe('metric selection', () => {
        it('splits translate and assist, and platform from bring-your-own', () => {
            expect(aiUsageMetric('translate', 'managed')).toBe('ai_translate');
            expect(aiUsageMetric('translate', 'byo')).toBe('ai_translate_byo');
            expect(aiUsageMetric('assist', 'managed')).toBe('ai_assist');
            expect(aiUsageMetric('assist', 'byo')).toBe('ai_assist_byo');
        });

        it('tags the metric from the same resolver the runtime runs on', () => {
            // Not a second "is this managed?" test that could disagree with the
            // credential actually used.
            const r = resolveAi({ profile: SAAS_PROFILE, tenantKey: 'own-key', managedKey: 'plat', managedEntitled: true, underCap: true, model: 'm' });
            expect(aiUsageMetric('assist', r!.source)).toBe('ai_assist_byo');
        });
    });

    describe('checkAiQuota', () => {
        it('meters paid managed usage without blocking it — no cap is configured', async () => {
            // Metering ships before enforcement: any cap chosen today would be
            // invented, and the metric is cheap to record and expensive to guess.
            await seedAdversely(new MeteringService(testD1));
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).resolves.toBeUndefined();
            await expect(g.checkAiQuota(T, 'pro', 'ai_assist')).resolves.toBeUndefined();
        });

        it('DOES block once a cap is configured — proving the guard can read the meter', async () => {
            // The control for the test above. Without this, "resolves" proves
            // nothing: a guard wired to the wrong table would also resolve.
            await seedAdversely(new MeteringService(testD1));
            const g = new PlanQuotaGuard(testD1, {
                enforced: true, billingPortalUrl: 'https://x/billing',
                aiCaps: { pro: { ai_translate: 10_000 } },
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).rejects.toMatchObject({
                status: 402,
                code: 'QUOTA_EXHAUSTED',
                // 4_000 + 6_000 across two period buckets — the lifetime total,
                // not whichever bucket sorted first.
                details: { metric: 'ai_translate', used: 10_000, cap: 10_000 },
            });
        });

        it('never counts BYO usage against a configured cap', async () => {
            // 9_000 of BYO translate volume against a cap of 10 — this can only
            // pass if the guard reads `ai_translate`, not `ai_translate_byo`.
            await new MeteringService(testD1).record(T, 'ai_translate_byo', '2026-06', 9_000);
            const g = new PlanQuotaGuard(testD1, {
                enforced: true, billingPortalUrl: null, aiCaps: { pro: { ai_translate: 10 } },
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).resolves.toBeUndefined();
        });

        it('keeps translate and assist independent', async () => {
            // A shared metric would force one cap to govern two workloads whose
            // cost profiles differ by an order of magnitude.
            await seedAdversely(new MeteringService(testD1));
            const g = new PlanQuotaGuard(testD1, {
                enforced: true, billingPortalUrl: null, aiCaps: { pro: { ai_assist: 100 } },
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_assist')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).resolves.toBeUndefined();
        });

        it('applies a cap only to the tier it was configured for', async () => {
            await seedAdversely(new MeteringService(testD1));
            const g = new PlanQuotaGuard(testD1, {
                enforced: true, billingPortalUrl: null, aiCaps: { pro: { ai_translate: 10 } },
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            await expect(g.checkAiQuota(T, 'enterprise', 'ai_translate')).resolves.toBeUndefined();
        });

        it('does not block when enforcement is off (standalone), even with a cap', async () => {
            await seedAdversely(new MeteringService(testD1));
            const g = new PlanQuotaGuard(testD1, {
                enforced: false, billingPortalUrl: null, aiCaps: { pro: { ai_translate: 1 } },
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).resolves.toBeUndefined();
        });

        /**
         * The DELIVERED path. Every case above hands the guard a caps OBJECT,
         * which no production site does — the seven construction sites pass a
         * LOADER, because two of them (the per-request DI middleware and the
         * cron tick reused across tenants) must not resolve one tenant's caps
         * eagerly and hand them to another tenant's check.
         *
         * Without these two cases the object-shaped suite above stays green
         * against a guard that silently ignores a function.
         */
        it('enforces caps that arrived as a LOADER, not just as an object', async () => {
            await seedAdversely(new MeteringService(testD1));
            const loader = vi.fn(async (tenantId: string) =>
                tenantId === T ? { pro: { ai_translate: 10_000 } } : undefined);
            const g = new PlanQuotaGuard(testD1, {
                enforced: true, billingPortalUrl: null, aiCaps: loader,
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).rejects.toMatchObject({
                code: 'QUOTA_EXHAUSTED',
                details: { metric: 'ai_translate', used: 10_000, cap: 10_000 },
            });
            // Resolved per check, with the tenant being checked — not once at
            // construction. This is the assertion that makes the shared cron
            // guard safe.
            expect(loader).toHaveBeenCalledWith(T);
        });

        it('a loader that reports nothing configured enforces nothing', async () => {
            // The unconfigured production state today: the deployment has been
            // given no allowance, so AI metering runs and AI enforcement does
            // not. FREE_TIER_CAPS is untouched by any of this — it governs
            // inspections/sms/email and carries no AI entry at all, which is
            // what keeps "no managed allowance" from silently inheriting one.
            await seedAdversely(new MeteringService(testD1));
            const g = new PlanQuotaGuard(testD1, {
                enforced: true, billingPortalUrl: null, aiCaps: async () => undefined,
            });
            await expect(g.checkAiQuota(T, 'pro', 'ai_translate')).resolves.toBeUndefined();
            expect(FREE_TIER_CAPS).not.toHaveProperty('ai_translate');
            expect(FREE_TIER_CAPS).not.toHaveProperty('ai_assist');
        });
    });

    describe('call-site metering', () => {
        const fetchMock = vi.fn();
        let originalFetch: typeof globalThis.fetch;

        beforeEach(() => {
            originalFetch = globalThis.fetch;
            globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
            fetchMock.mockReset();
        });
        afterEach(() => { globalThis.fetch = originalFetch; });

        function service(meter?: { record(kind: 'translate' | 'assist'): Promise<void> }) {
            // The tenant's own key with a confirmation on file — the only picture
            // the capability gate lets through, and the service defaults to
            // fail-closed, so these metering cases must say it. The provenance
            // sink is supplied for the same reason: the chokepoint refuses a
            // call it cannot record, and a case that omitted it would stop
            // saying anything about the METER (see provenance.spec.ts).
            return new AIService(
                {} as D1Database, 'a-key', 'saas', 'a-model', meter,
                { source: 'byo', tenantKeyAttested: true },
                { record: async () => 'ai-call-row' },
            );
        }

        it('records exactly once per successful call, tagged by workload', async () => {
            fetchMock.mockResolvedValue({
                ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }),
            } as Response);
            const record = vi.fn(async () => {});
            await service({ record }).generateProfessionalComment('note');
            expect(record).toHaveBeenCalledTimes(1);
            expect(record).toHaveBeenCalledWith('assist');
        });

        it('does NOT meter a failed model call', async () => {
            // Meter after success, check before: a provider failure must never
            // consume an allowance it did not spend. AI calls fail more often
            // than sends, so this ordering matters more here, not less.
            fetchMock.mockResolvedValue({ ok: false, text: async () => 'rate limited' } as Response);
            const record = vi.fn(async () => {});
            await expect(service({ record }).generateProfessionalComment('note')).rejects.toThrow();
            expect(record).not.toHaveBeenCalled();
        });

        it('a metering failure never fails the inspector operation', async () => {
            fetchMock.mockResolvedValue({
                ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'kept' }] } }] }),
            } as Response);
            const record = vi.fn(async () => { throw new Error('d1 down'); });
            await expect(service({ record }).generateProfessionalComment('note'))
                .resolves.toMatchObject({ text: 'kept' });
        });
    });

    describe('the free tier', () => {
        it('never offers managed AI at all — so there is nothing to cap', () => {
            // The free tier's boundary, expressed where it is actually enforced:
            // no entitlement, hence no managed credential, hence no platform
            // cost and no quota machinery.
            expect(resolveAi({
                profile: SAAS_PROFILE, tenantKey: null, managedKey: 'plat',
                managedEntitled: false, underCap: true, model: 'm',
            })).toBeNull();
        });

        it('carries no ai_* entry in FREE_TIER_CAPS', () => {
            // Assert on the ABSENCE of the keys, not on the object's value:
            // an equality check would still pass if a cap were added under a
            // name this test does not mention.
            expect(Object.keys(FREE_TIER_CAPS).some(k => k.startsWith('ai_'))).toBe(false);
        });
    });
});
