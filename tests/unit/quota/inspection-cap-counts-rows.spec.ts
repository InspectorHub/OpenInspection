import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';

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
        `INSERT INTO tenants (id, name, slug, created_at) VALUES (?, ?, ?, ?)`,
    ).run(tenantId, `Tenant ${tenantId}`, tenantId, Date.now());

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
