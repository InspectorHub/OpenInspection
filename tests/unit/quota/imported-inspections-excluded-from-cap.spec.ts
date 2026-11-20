/**
 * The free-tier inspection cap counts the inspections a tenant CREATED this
 * month — but a restored (imported) inspection is not a new inspection. It
 * carries its original created_at and is mapped in `import_id_map` with
 * `table_name = 'inspections'` and `new_id` = the live row id. Those rows must
 * NOT consume the free allowance, otherwise a tenant who restores a package
 * immediately finds themselves at cap and cannot create anything.
 *
 * Red-first: these assertions fail until PlanQuotaGuard's COUNT predicates
 * exclude rows whose id is an imported inspection's new_id.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';

import { lazyD1 } from '../helpers/d1-binding';
const fakeD1 = lazyD1();
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { FREE_TIER_CAPS } from '../../../server/features/plan-quota/policy';

describe('PlanQuotaGuard: imported inspections do NOT consume the free cap', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let testD1: D1Database;
    let guard: PlanQuotaGuard;

    const CAP = FREE_TIER_CAPS.inspections;
    const PKG = 'pkg-restored';

    beforeEach(async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        sqlite = fixture.sqlite;
        fakeD1.use(fixture.db);
        testD1 = fakeD1.binding;
        sqlite.prepare(
            `INSERT INTO tenants (id, slug, tier, created_at) VALUES ('t1', 'acme', 'free', ?)`,
        ).run(Date.now());
        guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
    });

    /** Seed one inspection. `imported` additionally writes the id-map anchor. */
    const seed = (id: string, imported: boolean) => {
        const now = Date.now();
        sqlite.prepare(
            `INSERT INTO inspections (id, tenant_id, property_address, date, created_at)
             VALUES (?, 't1', '1 Main St', '2026-01-01', ?)`,
        ).run(id, now);
        if (imported) {
            sqlite.prepare(
                `INSERT INTO import_id_map
                    (id, tenant_id, package_id, table_name, source_id, new_id, created_at)
                 VALUES (?, 't1', ?, 'inspections', ?, ?, ?)`,
            ).run(`map:${id}`, PKG, `src:${id}`, id, now);
        }
    };

    const seedMany = (n: number, imported: boolean, prefix = 'x') => {
        for (let i = 0; i < n; i++) seed(`${prefix}-${i}`, imported);
    };

    it('a workspace at cap with RESTORED inspections can still create', async () => {
        seedMany(CAP, true, 'restored');
        await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
    });

    it('a workspace far past cap with restored inspections is not refused', async () => {
        seedMany(CAP + 5, true, 'restored');
        await expect(guard.consumeInspection('t1')).resolves.toBeUndefined();
        await expect(guard.assertInspectionRoom('t1')).resolves.toBeUndefined();
    });

    it('assertInspectionRoom ignores restored inspections too', async () => {
        seedMany(CAP, true, 'restored');
        await expect(guard.assertInspectionRoom('t1')).resolves.toBeUndefined();
    });

    it('normal inspections still count toward the cap', async () => {
        seedMany(CAP, false, 'normal');
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
        await expect(guard.assertInspectionRoom('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });

    it('a mix counts only the real new inspections', async () => {
        seedMany(CAP, true, 'restored');
        seedMany(CAP - 1, false, 'normal');
        // Only CAP-1 real rows exist → one slot left; a batch of two overflows.
        await expect(guard.assertInspectionRoom('t1', 1)).resolves.toBeUndefined();
        await expect(guard.assertInspectionRoom('t1', 2)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });

    it('a mapping on another table does not exempt an inspection', async () => {
        // Guard against an over-broad NOT EXISTS that ignores table_name.
        seedMany(CAP, false, 'normal');
        const now = Date.now();
        sqlite.prepare(
            `INSERT INTO import_id_map
                (id, tenant_id, package_id, table_name, source_id, new_id, created_at)
             VALUES (?, 't1', ?, '__media', ?, ?, ?)`,
        ).run('map:media', PKG, 'src:media', 'normal-0', now);
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });

    it('the exemption is tenant-scoped', async () => {
        // A map row for a different tenant must not exempt this tenant's cap.
        seedMany(CAP, false, 'normal');
        const now = Date.now();
        sqlite.prepare(
            `INSERT INTO tenants (id, slug, tier, created_at) VALUES ('t2', 'other', 'free', ?)`,
        ).run(now);
        sqlite.prepare(
            `INSERT INTO import_id_map
                (id, tenant_id, package_id, table_name, source_id, new_id, created_at)
             VALUES (?, 't2', ?, 'inspections', ?, ?, ?)`,
        ).run('map:t2', PKG, 'src:t2', 'normal-0', now);
        await expect(guard.consumeInspection('t1')).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    });
});
