import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { comments, tenants } from '../../../server/lib/db/schema';

/**
 * Comments Library — severity + section filtering.
 *
 * `severity` (Module F's single vocabulary shared with rating levels: 'good'
 * | 'marginal' | 'significant' | 'minor') is the live successor to the
 * retired `rating_bucket` column, whose removal left it the only severity a
 * comment carries. This spec verifies
 * `severity` + `section` round-trip cleanly through Drizzle and that
 * filter-by-severity / filter-by-section / combined filters work the way the
 * /api/admin/comments route (server/api/admin/admin-comments.ts) expects.
 *
 * Also smoke-tests that rows with no severity set (the pre-Module-F shape)
 * stay queryable: `severity` defaults to null and must round-trip as such.
 */
describe('comments table — severity + section', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(tenants).values({
            id: 't1',
            slug: 'test',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
    });

    it('round-trips severity and section', async () => {
        await testDb.insert(comments).values({
            id: 'c1',
            tenantId: 't1',
            text: 'Active leak observed.',
            category: null,
            severity: 'significant',
            section: 'Plumbing',
            createdAt: new Date(),
        });

        const row = await testDb.select().from(comments).where(eq(comments.id, 'c1')).get();
        expect(row).toBeDefined();
        expect(row!.severity).toBe('significant');
        expect(row!.section).toBe('Plumbing');
    });

    it('keeps rows with no severity set queryable with null severity/section', async () => {
        // Simulate a row created before Module F's severity column shipped: no
        // severity or section. Both should default to null and round-trip.
        await testDb.insert(comments).values({
            id: 'c-legacy',
            tenantId: 't1',
            text: 'Legacy snippet.',
            category: 'Roofing',
            createdAt: new Date(),
        });

        const row = await testDb.select().from(comments).where(eq(comments.id, 'c-legacy')).get();
        expect(row).toBeDefined();
        expect(row!.severity).toBeNull();
        expect(row!.section).toBeNull();
        expect(row!.category).toBe('Roofing');
    });

    it('filters by severity + tenantId', async () => {
        await testDb.insert(comments).values([
            { id: 'a', tenantId: 't1', text: 'A', severity: 'good',        section: null, category: null, createdAt: new Date() },
            { id: 'b', tenantId: 't1', text: 'B', severity: 'marginal',    section: null, category: null, createdAt: new Date() },
            { id: 'c', tenantId: 't1', text: 'C', severity: 'significant', section: null, category: null, createdAt: new Date() },
            { id: 'd', tenantId: 't1', text: 'D', severity: 'significant', section: null, category: null, createdAt: new Date() },
        ]);

        const significant = await testDb.select().from(comments)
            .where(and(eq(comments.tenantId, 't1'), eq(comments.severity, 'significant')))
            .all();
        expect(significant).toHaveLength(2);
        expect(significant.map(r => r.id).sort()).toEqual(['c', 'd']);
    });

    it('filters by section + severity combined', async () => {
        await testDb.insert(comments).values([
            { id: 'r-good', tenantId: 't1', text: 'roof good', severity: 'good',        section: 'Roof',     category: null, createdAt: new Date() },
            { id: 'r-sig',  tenantId: 't1', text: 'roof sig',  severity: 'significant', section: 'Roof',     category: null, createdAt: new Date() },
            { id: 'p-sig',  tenantId: 't1', text: 'plmb sig',  severity: 'significant', section: 'Plumbing', category: null, createdAt: new Date() },
        ]);

        const roofSignificant = await testDb.select().from(comments)
            .where(and(
                eq(comments.tenantId, 't1'),
                eq(comments.severity, 'significant'),
                eq(comments.section, 'Roof'),
            ))
            .all();
        expect(roofSignificant).toHaveLength(1);
        expect(roofSignificant[0]!.id).toBe('r-sig');
    });

    it('does not leak across tenants when filtering by severity', async () => {
        // Tenant isolation rule (CLAUDE.md): severity filter alone is not
        // enough — must always combine with tenantId.
        await testDb.insert(tenants).values({
            id: 't2',
            slug: 'other',
            createdAt: new Date(),
        });
        await testDb.insert(comments).values([
            { id: 't1-sig', tenantId: 't1', text: 'mine',   severity: 'significant', section: null, category: null, createdAt: new Date() },
            { id: 't2-sig', tenantId: 't2', text: 'theirs', severity: 'significant', section: null, category: null, createdAt: new Date() },
        ]);

        const mine = await testDb.select().from(comments)
            .where(and(eq(comments.tenantId, 't1'), eq(comments.severity, 'significant')))
            .all();
        expect(mine).toHaveLength(1);
        expect(mine[0]!.id).toBe('t1-sig');
    });
});
