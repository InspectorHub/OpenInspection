// Free-tier inspection cap — real-D1 (workerd/miniflare) coverage.
//
// The unit suite runs the guard against better-sqlite3, which is SYNCHRONOUS:
// `Promise.all` there does not overlap anything, so it can only ever assert the
// statement's logic. Two things are testable only here:
//
//  1. That D1 accepts and runs the statement at all. It is not a shape D1 code
//     usually reaches for — `INSERT ... SELECT ... WHERE` with an `ON CONFLICT
//     ... DO UPDATE ... WHERE` whose predicate is a correlated subquery over
//     ANOTHER table, plus `excluded.` references inside that predicate — and
//     `meta.changes === 0` on the no-rows-selected path is exactly the signal
//     the whole gate reads.
//  2. What genuinely concurrent callers observe, rather than what a synchronous
//     driver lets us pretend they observe.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PlanQuotaGuard } from '../../server/features/plan-quota/guard';
import { FREE_TIER_CAPS } from '../../server/features/plan-quota/policy';

interface TestBindings { DB: D1Database }
const b = env as unknown as TestBindings;

const TENANT = 'tenant-quota';
const OTHER  = 'tenant-quota-other';
const CAP    = FREE_TIER_CAPS.inspections;

const guard = () => new PlanQuotaGuard(b.DB, { enforced: true, billingPortalUrl: null });

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'free', created_at INTEGER NOT NULL);",
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, property_address TEXT, date TEXT, created_at INTEGER NOT NULL);',
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS usage_counters (tenant_id TEXT NOT NULL, metric TEXT NOT NULL, period_key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, metric, period_key));',
    );
}

async function reset(): Promise<void> {
    await b.DB.exec('DELETE FROM usage_counters;');
    await b.DB.exec('DELETE FROM inspections;');
    await b.DB.exec('DELETE FROM tenants;');
    await b.DB.prepare('INSERT INTO tenants (id, slug, tier, created_at) VALUES (?, ?, ?, ?)')
        .bind(TENANT, 'acme', 'free', Date.now()).run();
    await b.DB.prepare('INSERT INTO tenants (id, slug, tier, created_at) VALUES (?, ?, ?, ?)')
        .bind(OTHER, 'other', 'free', Date.now()).run();
}

/** The row a caller inserts right after a successful consume. */
async function addInspections(tenantId: string, n: number): Promise<void> {
    const existing = await rowCount(tenantId);
    for (let i = 0; i < n; i++) {
        await b.DB.prepare(
            "INSERT INTO inspections (id, tenant_id, property_address, date, created_at) VALUES (?, ?, '1 Main St', '2026-08-05', ?)",
        ).bind(`${tenantId}-insp-${existing + i}`, tenantId, Date.now()).run();
    }
}

async function rowCount(tenantId: string): Promise<number> {
    const r = await b.DB.prepare('SELECT COUNT(*) AS n FROM inspections WHERE tenant_id = ?')
        .bind(tenantId).first<{ n: number }>();
    return r?.n ?? 0;
}

async function counter(tenantId: string): Promise<number | null> {
    const r = await b.DB.prepare(
        "SELECT value FROM usage_counters WHERE tenant_id = ? AND metric = 'inspections' AND period_key = 'lifetime'",
    ).bind(tenantId).first<{ value: number }>();
    return r?.value ?? null;
}

describe('free-tier inspection cap on real D1', () => {
    beforeAll(seedSchema);
    beforeEach(reset);

    it('runs the statement and gates on the row count', async () => {
        await addInspections(TENANT, CAP - 1);
        await expect(guard().consumeInspection(TENANT)).resolves.toBeUndefined();
        expect(await counter(TENANT)).toBe(CAP);

        await addInspections(TENANT, 1);   // the caller's insert lands
        await expect(guard().consumeInspection(TENANT)).rejects.toMatchObject({
            status: 402, code: 'QUOTA_EXHAUSTED',
        });
    });

    it('gates the INSERT branch too — over cap with no counter row is still refused', async () => {
        // The reason the statement is `INSERT ... SELECT ... WHERE` and not
        // `INSERT ... VALUES`: a conflict-free INSERT never reaches DO UPDATE,
        // so its WHERE cannot refuse anyone.
        await addInspections(TENANT, CAP + 4);
        expect(await counter(TENANT)).toBeNull();

        await expect(guard().consumeInspection(TENANT)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        expect(await counter(TENANT)).toBeNull();   // nothing was written at all
    });

    it('excluded.tenant_id resolves per tenant inside DO UPDATE ... WHERE', async () => {
        // A sibling tenant's rows must not count toward this one's cap. If
        // `excluded.` were out of scope here D1 would raise, not miscount.
        await addInspections(OTHER, CAP + 10);
        await addInspections(TENANT, 1);
        await guard().consumeInspection(TENANT);                 // creates the counter row
        await addInspections(TENANT, 1);
        await expect(guard().consumeInspection(TENANT)).resolves.toBeUndefined();   // UPDATE branch
        expect(await counter(TENANT)).toBe(3);
    });

    it('a stale counter cannot block a tenant under the cap — the production defect', async () => {
        // 2026-08-05: one tenant had a single inspection row and a counter of 4.
        await addInspections(TENANT, 1);
        await b.DB.prepare(
            "INSERT INTO usage_counters (tenant_id, metric, period_key, value, updated_at) VALUES (?, 'inspections', 'lifetime', ?, ?)",
        ).bind(TENANT, CAP - 1, Date.now()).run();

        await expect(guard().consumeInspection(TENANT)).resolves.toBeUndefined();
        expect(await counter(TENANT)).toBe(2);   // healed down to the truth
    });

    it('AT the cap, genuinely concurrent consumes ALL fail — no phantom pass', async () => {
        // Real overlap: workerd runs these D1 calls as genuine concurrent async
        // I/O, unlike the synchronous better-sqlite3 unit harness.
        await addInspections(TENANT, CAP);
        const results = await Promise.allSettled(
            Array.from({ length: 6 }, () => guard().consumeInspection(TENANT)),
        );
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(0);
        expect(await counter(TENANT)).toBeNull();
    });

    it('a batch is admitted whole or not at all under real overlap', async () => {
        await addInspections(TENANT, 3);
        // 3 + 3 > 5 — both concurrent batch attempts must be refused outright;
        // neither may consume part of its batch.
        const results = await Promise.allSettled([
            guard().consumeInspection(TENANT, 3), guard().consumeInspection(TENANT, 3),
        ]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(0);
        expect(await counter(TENANT)).toBeNull();

        // 3 + 2 fits exactly.
        await expect(guard().consumeInspection(TENANT, 2)).resolves.toBeUndefined();
        expect(await counter(TENANT)).toBe(CAP);
    });

    it('the documented bound: consumes overlapping BEFORE their rows land both pass', async () => {
        // Pinned deliberately rather than left to be discovered. Counting rows
        // makes the cap a steady-state invariant: the caller inserts its row
        // after consumeInspection returns, so overlapping creates read the same
        // count. Real workerd concurrency, so this is the true behaviour and not
        // an artefact of a synchronous test driver.
        await addInspections(TENANT, CAP - 1);
        const results = await Promise.allSettled([
            guard().consumeInspection(TENANT), guard().consumeInspection(TENANT),
        ]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);

        // ...and it self-corrects: once both rows exist the tenant is over the
        // cap and cannot grow further.
        await addInspections(TENANT, 2);
        expect(await rowCount(TENANT)).toBe(CAP + 1);
        await expect(guard().consumeInspection(TENANT)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });
});
