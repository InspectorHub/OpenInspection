import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';

// Same mocking pattern as tests/unit/usage/plan-quota.spec.ts: the guard's
// `drizzle(d1)` calls (tier lookup, MeteringService) resolve to the in-memory
// SQLite Drizzle instance, while its raw `db.prepare(...).bind(...).run()` path
// runs against `toRawD1` over the same underlying sqlite.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { MeteringService } from '../../../server/services/metering.service';
import { FREE_TIER_CAPS } from '../../../server/features/plan-quota/policy';

/**
 * The inspection cap is enforced by a single conditional upsert whose WHERE
 * counts rows in another table. `meta.changes === 0` is what the guard reads to
 * mean "at cap", so this asserts the primitive itself rather than trusting it.
 *
 * Specifically: does a conditional upsert whose `DO UPDATE ... WHERE` holds a
 * correlated subquery report `changes === 0` when that subquery is false, and
 * is `excluded.tenant_id` in scope there at all? Both are assumptions about
 * SQLite/D1, not about our code, and the concurrency guarantee rests on them.
 */
describe('D1/SQLite: conditional upsert with a correlated subquery', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        sqlite = t.sqlite;
    });

    /** `inspections.tenant_id` carries a legacy FK, and better-sqlite3 enforces
     *  foreign keys by default — so the parent row has to exist first. */
    const seedTenant = (tenantId: string) => sqlite.prepare(
        `INSERT INTO tenants (id, slug, created_at) VALUES (?, ?, ?)`,
    ).run(tenantId, tenantId, Date.now());

    /** Minimal inspection rows — only the NOT NULL columns are supplied. */
    const seedInspections = (tenantId: string, n: number) => {
        const stmt = sqlite.prepare(
            `INSERT INTO inspections (id, tenant_id, property_address, date, created_at)
             VALUES (?, ?, '1 Main St', '2026-08-05', ?)`,
        );
        const base = countRows(tenantId);   // so repeated calls do not collide on id
        for (let i = 0; i < n; i++) stmt.run(`${tenantId}-insp-${base + i}`, tenantId, Date.now());
    };

    const deleteInspections = (tenantId: string, n: number) =>
        sqlite.prepare(
            `DELETE FROM inspections WHERE rowid IN
             (SELECT rowid FROM inspections WHERE tenant_id = ? LIMIT ?)`,
        ).run(tenantId, n);

    const countRows = (tenantId: string) =>
        sqlite.prepare('SELECT COUNT(*) AS n FROM inspections WHERE tenant_id = ?').get(tenantId).n;

    const readCounter = (tenantId: string) =>
        sqlite.prepare(
            `SELECT value FROM usage_counters
             WHERE tenant_id = ? AND metric = 'inspections' AND period_key = 'lifetime'`,
        ).get(tenantId)?.value;

    /** The exact statement shape the guard will use, `excluded.` references and all. */
    const upsert = (tenantId: string, cap: number) => sqlite.prepare(
        `INSERT INTO usage_counters (tenant_id, metric, period_key, value, updated_at)
         VALUES (?, 'inspections', 'lifetime',
                 (SELECT COUNT(*) FROM inspections WHERE tenant_id = ?) + 1, ?)
         ON CONFLICT(tenant_id, metric, period_key)
         DO UPDATE SET value = (SELECT COUNT(*) FROM inspections WHERE tenant_id = excluded.tenant_id) + 1,
                       updated_at = excluded.updated_at
         WHERE (SELECT COUNT(*) FROM inspections WHERE tenant_id = excluded.tenant_id) < ?`,
    ).run(tenantId, tenantId, Date.now(), cap);

    it('reports changes > 0 while under the cap', () => {
        seedTenant('t1');
        seedInspections('t1', 2);
        expect(upsert('t1', 5).changes).toBeGreaterThan(0);
    });

    it('reports changes === 0 once the row count reaches the cap', () => {
        seedTenant('t1');
        seedInspections('t1', 5);
        upsert('t1', 5);            // creates the row (INSERT branch — no WHERE applies)
        expect(upsert('t1', 5).changes).toBe(0);
    });

    it('the plain VALUES form leaves the INSERT branch UNGATED', () => {
        // A conflict-free INSERT never reaches DO UPDATE, so its WHERE cannot
        // block it: a tenant already over the cap but with no counter row yet
        // gets a free pass. Documented here because it is why the guard uses
        // the INSERT...SELECT form below instead.
        seedTenant('t1');
        seedInspections('t1', 9);
        expect(upsert('t1', 5).changes).toBeGreaterThan(0);
    });

    /** The form the guard actually uses: `INSERT ... SELECT ... WHERE` so the
     *  same row-count predicate gates the INSERT branch as well as the UPDATE. */
    const gatedUpsert = (tenantId: string, cap: number) => sqlite.prepare(
        `INSERT INTO usage_counters (tenant_id, metric, period_key, value, updated_at)
         SELECT ?, 'inspections', 'lifetime', cnt.n + 1, ?
         FROM (SELECT COUNT(*) AS n FROM inspections WHERE tenant_id = ?) AS cnt
         WHERE cnt.n < ?
         ON CONFLICT(tenant_id, metric, period_key)
         DO UPDATE SET value = (SELECT COUNT(*) FROM inspections WHERE tenant_id = excluded.tenant_id) + 1,
                       updated_at = excluded.updated_at
         WHERE (SELECT COUNT(*) FROM inspections WHERE tenant_id = excluded.tenant_id) < ?`,
    ).run(tenantId, Date.now(), tenantId, cap, cap);

    it('the gated INSERT...SELECT form refuses a tenant already over the cap with no counter row', () => {
        seedTenant('t1');
        seedInspections('t1', 9);
        expect(gatedUpsert('t1', 5).changes).toBe(0);
        expect(readCounter('t1')).toBeUndefined();   // no row was written at all
    });

    it('the gated form still admits a tenant under the cap with no counter row', () => {
        seedTenant('t1');
        seedInspections('t1', 2);
        expect(gatedUpsert('t1', 5).changes).toBeGreaterThan(0);
        expect(readCounter('t1')).toBe(3);
    });

    it('the gated form behaves identically to the plain form on the UPDATE branch', () => {
        seedTenant('t1');
        seedInspections('t1', 4);
        expect(gatedUpsert('t1', 5).changes).toBeGreaterThan(0);   // 4 rows < 5 → allowed
        seedInspections('t1', 1);                                  // the create lands: 5 rows
        expect(gatedUpsert('t1', 5).changes).toBe(0);              // now at cap
    });

    it('excluded.tenant_id IS in scope inside DO UPDATE ... WHERE', () => {
        // If it were not, SQLite would raise "no such column" rather than run.
        seedTenant('t1');
        seedTenant('t2');
        seedInspections('t1', 1);
        seedInspections('t2', 9);
        upsert('t1', 5);
        expect(() => upsert('t1', 5)).not.toThrow();
        // And it resolves to THIS tenant: t2's 9 rows must not cap t1.
        expect(upsert('t1', 5).changes).toBeGreaterThan(0);
    });

    it('lets the count FALL again when rows are deleted — the whole point', () => {
        seedTenant('t1');
        seedInspections('t1', 5);
        upsert('t1', 5);
        expect(upsert('t1', 5).changes).toBe(0);   // at cap

        deleteInspections('t1', 3);
        expect(countRows('t1')).toBe(2);
        expect(upsert('t1', 5).changes).toBeGreaterThan(0);   // allowance returned
        expect(readCounter('t1')).toBe(3);                    // cache heals to rows + this create
    });
});

/**
 * The behaviour that primitive buys: the free-tier inspection cap gates on the
 * inspections a tenant HAS, not on how many they have ever created. Deleting an
 * inspection returns the allowance, and a stale `usage_counters.value` cannot
 * block a tenant who is genuinely under the cap.
 *
 * The 2026-08-05 production defect is reproduced verbatim in the stale-counter
 * case: one tenant had a single inspection row and a counter reading 4 of 5.
 */
describe('PlanQuotaGuard.consumeInspection counts rows, not creates', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let testD1: D1Database;
    let guard: PlanQuotaGuard;

    const CAP = FREE_TIER_CAPS.inspections;

    beforeEach(async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        sqlite = fixture.sqlite;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(fixture.db);
        testD1 = toRawD1(sqlite);
        sqlite.prepare(
            `INSERT INTO tenants (id, slug, tier, created_at) VALUES (?, ?, 'free', ?)`,
        ).run('t1', 'acme', Date.now());
        guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
    });

    const countRows = () =>
        sqlite.prepare("SELECT COUNT(*) AS n FROM inspections WHERE tenant_id = 't1'").get().n;

    const seedInspections = (n: number) => {
        const stmt = sqlite.prepare(
            `INSERT INTO inspections (id, tenant_id, property_address, date, created_at)
             VALUES (?, 't1', '1 Main St', '2026-08-05', ?)`,
        );
        const base = countRows();
        for (let i = 0; i < n; i++) stmt.run(`insp-${base + i}`, Date.now());
    };

    const deleteInspections = (n: number) => sqlite.prepare(
        `DELETE FROM inspections WHERE rowid IN
         (SELECT rowid FROM inspections WHERE tenant_id = 't1' LIMIT ?)`,
    ).run(n);

    const setCounter = (value: number) => sqlite.prepare(
        `INSERT INTO usage_counters (tenant_id, metric, period_key, value, updated_at)
         VALUES ('t1', 'inspections', 'lifetime', ?, ?)
         ON CONFLICT(tenant_id, metric, period_key) DO UPDATE SET value = excluded.value`,
    ).run(value, Date.now());

    it('a tenant with 5 inspections is at cap', async () => {
        seedInspections(CAP);
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({
            status: 402, code: 'QUOTA_EXHAUSTED',
        });
    });

    it('deleting an inspection returns the allowance — the defect this fixes', async () => {
        seedInspections(CAP);
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        deleteInspections(2);                                   // user cleans up duplicates
        await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
    });

    it('a stale counter does not block a tenant who is genuinely under the cap', async () => {
        // The exact production state on 2026-08-05: counter said 4, one row existed.
        seedInspections(1);
        setCounter(4);
        await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        // ...and the counter heals to the truth rather than climbing from 4.
        expect(await new MeteringService(testD1).lifetimeTotal('t1', 'inspections')).toBe(2);
    });

    it('a tenant over the cap with NO counter row is still refused', async () => {
        // The INSERT branch has to be gated too — see the probe above. Reachable
        // whenever rows exist without a counter (imports, a counter row deleted
        // by hand to "fix" a stale value).
        seedInspections(9);
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        expect(await new MeteringService(testD1).lifetimeTotal('t1', 'inspections')).toBe(0);
    });

    it('the counter tracks the row count as a cache, one create ahead of the insert', async () => {
        // consumeInspection runs immediately BEFORE the row is inserted, so the
        // cached value is "rows now + this create" — which equals the row count
        // once the caller's insert lands.
        seedInspections(2);
        await guard.consumeInspection('t1');
        expect(await new MeteringService(testD1).lifetimeTotal('t1', 'inspections')).toBe(3);
    });

    it('sms and email still TALLY — they have no rows to count', async () => {
        const metering = new MeteringService(testD1);
        await metering.record('t1', 'email', '2026-08');
        await metering.record('t1', 'email', '2026-08');
        expect(await metering.lifetimeTotal('t1', 'email')).toBe(2);

        // And the messaging gate still reads that tally, with zero rows anywhere
        // to count — converting it to a row count would silently uncap it.
        await metering.record('t1', 'sms', '2026-08', FREE_TIER_CAPS.sms);
        await expect(guard.checkMessagingQuota('t1', 'free', 'sms')).rejects.toMatchObject({
            code: 'QUOTA_EXHAUSTED',
        });
    });

    it('a second consume is refused once the first create has landed', async () => {
        // HONEST LIMITATION: better-sqlite3 is synchronous, so nothing in this
        // file can overlap two calls; this asserts the statement's LOGIC, not
        // concurrency. Real overlap is exercised under workerd in
        // tests/workers/quota-cap-concurrency.spec.ts.
        seedInspections(4);
        await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        seedInspections(1);                                   // the caller's insert lands
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });

    it('two consumes that overlap BEFORE either row lands both pass — the accepted bound', async () => {
        // Counting rows moves the cap from "serialized claim" to "steady-state
        // invariant": the caller inserts its row after consumeInspection returns,
        // so overlapping creates see the same count. The overshoot is bounded by
        // in-flight concurrency and self-corrects — asserted below. This is the
        // deliberate trade recorded in guard.ts, pinned so a future change that
        // silently alters it has to come here and say so.
        seedInspections(4);
        const results = await Promise.allSettled([
            guard.consumeInspection('t1'), guard.consumeInspection('t1'),
        ]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);

        // ...and it self-corrects: with both rows landed the tenant is over the
        // cap and cannot grow further.
        seedInspections(2);
        expect(countRows()).toBe(6);
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });
});
