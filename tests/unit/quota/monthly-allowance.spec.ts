import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { lazyD1 } from '../helpers/d1-binding';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { MeteringService } from '../../../server/services/metering.service';
import { FREE_TIER_CAPS } from '../../../server/features/plan-quota/policy';
import { monthStartUtcMs, nextMonthStartUtcMs } from '../../../server/lib/usage/period';

const fakeD1 = lazyD1();

/**
 * The Free plan allowance renews on the calendar month, in UTC. Inspections are
 * counted by the month each one was CREATED in; built-in emails by the month
 * they were sent in. These specs pin the boundary to the millisecond, because an
 * off-by-one here either locks a company out for a day or hands out a second
 * allowance, and neither shows up anywhere else.
 */
describe('monthStartUtcMs / nextMonthStartUtcMs', () => {
    const dates = [
        '2026-03-15T10:00:00Z', '2026-12-31T23:59:59.999Z', '2027-01-01T00:00:00.000Z',
        '2028-02-29T12:00:00Z', '2026-02-28T23:59:59.999Z', '2026-07-31T23:59:59.999Z',
    ];

    it.each(dates)('monthStartUtcMs(%s) is Date.UTC(year, month, 1)', (iso) => {
        const d = new Date(iso);
        expect(monthStartUtcMs(d)).toBe(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    });

    it('is 00:00:00.000 UTC on the first day', () => {
        expect(monthStartUtcMs(new Date('2026-03-15T10:00:00Z'))).toBe(Date.UTC(2026, 2, 1));
        expect(monthStartUtcMs(new Date('2028-02-29T23:59:59.999Z'))).toBe(Date.UTC(2028, 1, 1));
    });

    it('nextMonthStartUtcMs rolls December into January of the next year', () => {
        expect(nextMonthStartUtcMs(new Date('2026-12-31T23:59:59.999Z'))).toBe(Date.UTC(2027, 0, 1));
        expect(nextMonthStartUtcMs(new Date('2028-02-29T12:00:00Z'))).toBe(Date.UTC(2028, 2, 1));
        expect(nextMonthStartUtcMs(new Date('2026-11-08T00:00:00Z'))).toBe(Date.UTC(2026, 11, 1));
    });
});

describe('Free plan monthly allowance (PlanQuotaGuard)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let guard: PlanQuotaGuard;
    const CAP = FREE_TIER_CAPS.inspections;
    const EMAIL_CAP = FREE_TIER_CAPS.email;
    let seq = 0;

    const setTier = (id: string, tier: string) => sqlite.prepare(
        `INSERT INTO tenants (id, slug, tier, created_at) VALUES (?, ?, ?, ?)`,
    ).run(id, id, tier, Date.now());

    const seedAt = (tenantId: string, iso: string, n = 1): string[] => {
        const ids: string[] = [];
        const stmt = sqlite.prepare(
            `INSERT INTO inspections (id, tenant_id, property_address, date, created_at)
             VALUES (?, ?, '1 Main St', '2026-11-01', ?)`,
        );
        for (let i = 0; i < n; i++) {
            const id = `insp-${seq++}`;
            stmt.run(id, tenantId, new Date(iso).getTime());
            ids.push(id);
        }
        return ids;
    };
    const remove = (ids: string[]) => {
        for (const id of ids) sqlite.prepare('DELETE FROM inspections WHERE id = ?').run(id);
    };
    const nowIs = (iso: string) => vi.setSystemTime(new Date(iso));

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        nowIs('2026-11-15T12:00:00.000Z');
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        sqlite = fixture.sqlite;
        fakeD1.use(fixture.db);
        setTier('t1', 'free');
        guard = new PlanQuotaGuard(fakeD1.binding, { enforced: true, billingPortalUrl: null });
    });
    afterEach(() => { vi.useRealTimers(); });

    describe('inspections', () => {
        it('admits up to the cap in the month and refuses the next', async () => {
            for (let i = 0; i < CAP; i++) {
                await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
                seedAt('t1', '2026-11-15T12:00:00.000Z');   // the caller inserts after consuming
            }
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED' });
        });

        it('an inspection from last month does not count', async () => {
            seedAt('t1', '2026-10-31T23:59:59.999Z', CAP);
            await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
            await expect(guard.assertInspectionRoom('t1', CAP)).resolves.toBeUndefined();
        });

        it('the last millisecond of a month counts for that month, not the next', async () => {
            seedAt('t1', '2026-11-30T23:59:59.999Z', CAP);
            nowIs('2026-11-30T23:59:59.999Z');
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            await expect(guard.assertInspectionRoom('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        });

        it('at 00:00:00.000 UTC on the 1st the new month starts at zero', async () => {
            seedAt('t1', '2026-11-30T23:59:59.999Z', CAP);
            nowIs('2026-12-01T00:00:00.000Z');
            await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        });

        it('an inspection created at exactly 00:00:00.000 on the 1st belongs to the new month', async () => {
            seedAt('t1', '2026-12-01T00:00:00.000Z', CAP);
            nowIs('2026-12-01T00:00:00.000Z');
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        });

        it('December rolls over into January', async () => {
            seedAt('t1', '2026-12-31T23:59:59.999Z', CAP);
            nowIs('2026-12-31T23:59:59.999Z');
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            nowIs('2027-01-01T00:00:00.000Z');
            await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        });

        it("deleting this month's inspection releases its place", async () => {
            const ids = seedAt('t1', '2026-11-03T09:00:00.000Z', CAP);
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            remove([ids[0]!]);
            await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        });

        it("deleting an older month's inspection releases nothing", async () => {
            const thisMonth = seedAt('t1', '2026-11-03T09:00:00.000Z', CAP);
            const old = seedAt('t1', '2026-09-03T09:00:00.000Z', 2);
            remove(old);
            expect(thisMonth).toHaveLength(CAP);
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        });

        it('a batch is admitted only when the whole batch fits in the month', async () => {
            seedAt('t1', '2026-11-03T09:00:00.000Z', CAP - 1);
            await expect(guard.consumeInspection('t1', 2)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            await expect(guard.consumeInspection('t1', 1)).resolves.toBeUndefined();
        });

        it('the cache row holds this month\'s count and releaseInspection re-measures it for the month', async () => {
            seedAt('t1', '2026-10-20T09:00:00.000Z', 3);
            seedAt('t1', '2026-11-03T09:00:00.000Z', 2);
            await guard.consumeInspection('t1');
            expect(await new MeteringService(fakeD1.binding).getCount('t1', 'inspections', 'lifetime')).toBe(3);
            await guard.releaseInspection('t1');
            expect(await new MeteringService(fakeD1.binding).getCount('t1', 'inspections', 'lifetime')).toBe(2);
        });

        it('a cancelled inspection still counts (status does not release a place)', async () => {
            const ids = seedAt('t1', '2026-11-03T09:00:00.000Z', CAP);
            sqlite.prepare("UPDATE inspections SET status = 'cancelled' WHERE id = ?").run(ids[0]);
            await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        });

        it('standalone (not enforced) is uncapped', async () => {
            const standalone = new PlanQuotaGuard(fakeD1.binding, { enforced: false, billingPortalUrl: null });
            seedAt('t1', '2026-11-03T09:00:00.000Z', CAP + 5);
            await expect(standalone.consumeInspection('t1')).resolves.toBeUndefined();
            await expect(standalone.assertInspectionRoom('t1', 10)).resolves.toBeUndefined();
        });

        it('a paid plan is uncapped', async () => {
            setTier('t2', 'pro');
            seedAt('t2', '2026-11-03T09:00:00.000Z', CAP + 5);
            await expect(guard.consumeInspection('t2')).resolves.toBeUndefined();
            await expect(guard.assertInspectionRoom('t2', 10)).resolves.toBeUndefined();
        });

        it('another tenant\'s inspections do not count', async () => {
            setTier('t3', 'free');
            seedAt('t3', '2026-11-03T09:00:00.000Z', CAP);
            await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        });

        it('the refusal names the month and when it renews', async () => {
            seedAt('t1', '2026-11-03T09:00:00.000Z', CAP);
            const err = await guard.consumeInspection('t1').catch((e: unknown) => e);
            expect(err).toMatchObject({
                status: 402, code: 'QUOTA_EXHAUSTED',
                details: { metric: 'inspections', used: CAP, cap: CAP, period: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z' },
            });
            const pre = await guard.assertInspectionRoom('t1').catch((e: unknown) => e);
            expect(pre).toMatchObject({ details: { period: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z' } });
        });
    });

    describe('built-in emails', () => {
        const metering = () => new MeteringService(fakeD1.binding);

        it('stays under the cap within the month and is refused at it', async () => {
            await metering().record('t1', 'email', '2026-11', EMAIL_CAP - 1);
            await expect(guard.checkMessagingQuota('t1', 'free', 'email')).resolves.toBeUndefined();
            await metering().record('t1', 'email', '2026-11');
            await expect(guard.checkMessagingQuota('t1', 'free', 'email')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        });

        it('last month\'s sends do not count toward this month', async () => {
            await metering().record('t1', 'email', '2026-10', EMAIL_CAP + 10);
            await expect(guard.checkMessagingQuota('t1', 'free', 'email')).resolves.toBeUndefined();
        });

        it('the count resets in a new month', async () => {
            await metering().record('t1', 'email', '2026-11', EMAIL_CAP);
            await expect(guard.checkMessagingQuota('t1', 'free', 'email')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            nowIs('2026-12-01T00:00:00.000Z');
            await expect(guard.checkMessagingQuota('t1', 'free', 'email')).resolves.toBeUndefined();
        });

        it('the refusal carries the month, the used count and the reset instant', async () => {
            await metering().record('t1', 'email', '2026-11', EMAIL_CAP);
            const err = await guard.checkMessagingQuota('t1', 'free', 'email').catch((e: unknown) => e);
            expect(err).toMatchObject({
                details: { metric: 'email', used: EMAIL_CAP, cap: EMAIL_CAP, period: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z' },
            });
        });

        it('standalone and paid plans are uncapped', async () => {
            await metering().record('t1', 'email', '2026-11', EMAIL_CAP + 5);
            const standalone = new PlanQuotaGuard(fakeD1.binding, { enforced: false, billingPortalUrl: null });
            await expect(standalone.checkMessagingQuota('t1', 'free', 'email')).resolves.toBeUndefined();
            await expect(guard.checkMessagingQuota('t1', 'pro', 'email')).resolves.toBeUndefined();
        });
    });
});
