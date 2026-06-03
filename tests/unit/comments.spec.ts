import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { comments, tenants } from '../../server/lib/db/schema';

/**
 * Spec 2026-05-07 — Comments Library unification.
 *
 * Verifies that the new `rating_bucket` + `section` columns added in
 * migration 0039 round-trip cleanly through Drizzle and that filter-by-bucket
 * / filter-by-section / combined filters work the way the /api/admin/comments
 * route expects.
 *
 * Smoke-tests migration backward compatibility too: rows inserted with the
 * pre-migration shape (no bucket / no section) MUST survive and stay queryable.
 */
describe('comments table — rating bucket + section', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(tenants).values({
            id: 't1',
            name: 'Test Tenant',
            slug: 'test',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
    });

    it('round-trips ratingBucket and section', async () => {
        await testDb.insert(comments).values({
            id: 'c1',
            tenantId: 't1',
            text: 'Active leak observed.',
            category: null,
            ratingBucket: 'defect',
            section: 'Plumbing',
            createdAt: new Date(),
        });

        const row = await testDb.select().from(comments).where(eq(comments.id, 'c1')).get();
        expect(row).toBeDefined();
        expect(row!.ratingBucket).toBe('defect');
        expect(row!.section).toBe('Plumbing');
    });

    it('keeps pre-migration rows queryable with null bucket/section', async () => {
        // Simulate a row created before the 0039 migration shipped: no
        // bucket or section. Both should default to null and round-trip.
        await testDb.insert(comments).values({
            id: 'c-legacy',
            tenantId: 't1',
            text: 'Legacy snippet.',
            category: 'Roofing',
            createdAt: new Date(),
        });

        const row = await testDb.select().from(comments).where(eq(comments.id, 'c-legacy')).get();
        expect(row).toBeDefined();
        expect(row!.ratingBucket).toBeNull();
        expect(row!.section).toBeNull();
        expect(row!.category).toBe('Roofing');
    });

    it('filters by ratingBucket + tenantId', async () => {
        await testDb.insert(comments).values([
            { id: 'a', tenantId: 't1', text: 'A', ratingBucket: 'satisfactory', section: null, category: null, createdAt: new Date() },
            { id: 'b', tenantId: 't1', text: 'B', ratingBucket: 'monitor',      section: null, category: null, createdAt: new Date() },
            { id: 'c', tenantId: 't1', text: 'C', ratingBucket: 'defect',       section: null, category: null, createdAt: new Date() },
            { id: 'd', tenantId: 't1', text: 'D', ratingBucket: 'defect',       section: null, category: null, createdAt: new Date() },
        ]);

        const defects = await testDb.select().from(comments)
            .where(and(eq(comments.tenantId, 't1'), eq(comments.ratingBucket, 'defect')))
            .all();
        expect(defects).toHaveLength(2);
        expect(defects.map(r => r.id).sort()).toEqual(['c', 'd']);
    });

    it('filters by section + ratingBucket combined', async () => {
        await testDb.insert(comments).values([
            { id: 'r-sat',  tenantId: 't1', text: 'roof sat',  ratingBucket: 'satisfactory', section: 'Roof',     category: null, createdAt: new Date() },
            { id: 'r-def',  tenantId: 't1', text: 'roof def',  ratingBucket: 'defect',       section: 'Roof',     category: null, createdAt: new Date() },
            { id: 'p-def',  tenantId: 't1', text: 'plmb def',  ratingBucket: 'defect',       section: 'Plumbing', category: null, createdAt: new Date() },
        ]);

        const roofDefects = await testDb.select().from(comments)
            .where(and(
                eq(comments.tenantId, 't1'),
                eq(comments.ratingBucket, 'defect'),
                eq(comments.section, 'Roof'),
            ))
            .all();
        expect(roofDefects).toHaveLength(1);
        expect(roofDefects[0]!.id).toBe('r-def');
    });

    it('does not leak across tenants when filtering by bucket', async () => {
        // Tenant isolation rule (CLAUDE.md): bucket filter alone is not
        // enough — must always combine with tenantId.
        await testDb.insert(tenants).values({
            id: 't2',
            name: 'Other Tenant',
            slug: 'other',
            createdAt: new Date(),
        });
        await testDb.insert(comments).values([
            { id: 't1-def', tenantId: 't1', text: 'mine',  ratingBucket: 'defect', section: null, category: null, createdAt: new Date() },
            { id: 't2-def', tenantId: 't2', text: 'theirs', ratingBucket: 'defect', section: null, category: null, createdAt: new Date() },
        ]);

        const mine = await testDb.select().from(comments)
            .where(and(eq(comments.tenantId, 't1'), eq(comments.ratingBucket, 'defect')))
            .all();
        expect(mine).toHaveLength(1);
        expect(mine[0]!.id).toBe('t1-def');
    });
});
