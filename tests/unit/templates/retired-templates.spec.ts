/**
 * Retiring a template is a visibility change, never a delete.
 *
 * `inspections.template_id` carries a legacy foreign key to this table, so D1
 * refuses to remove a referenced row -- and the row should survive regardless,
 * because re-issuing an old report reads the inspection's own snapshot rather
 * than the live template.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNull, isNotNull } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { TestDb } from '../helpers/test-db';

const TENANT = 'tenant-retired-1';

describe('retired templates', () => {
    let db: TestDb;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'retired', createdAt: new Date(),
        });
    });
    afterEach(() => { sqlite.close(); });

    it('a retired template is excluded from selection but still readable by id', async () => {
        await db.insert(schema.templates).values([
            {
                id: 'tpl-old', tenantId: TENANT, name: 'TREC 7-6',
                schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
                retiredAt: new Date(),
            },
            // The positive control. A column that read as retired for every row
            // -- or a filter that rejected everything -- would satisfy the
            // "excluded" assertion just as happily.
            {
                id: 'tpl-live', tenantId: TENANT, name: 'TREC 7-7',
                schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
            },
        ]);

        const selectable = await db.select().from(schema.templates)
            .where(isNull(schema.templates.retiredAt)).all();
        expect(selectable.map(r => r.id)).toEqual(['tpl-live']);

        const retired = await db.select().from(schema.templates)
            .where(isNotNull(schema.templates.retiredAt)).all();
        expect(retired.map(r => r.id)).toEqual(['tpl-old']);

        // Still there. An inspection's templateId points at it (legacy FK), and
        // deleting the row is not an option D1 offers.
        const all = await db.select().from(schema.templates).all();
        expect(all).toHaveLength(2);
    });

    it('defaults to null, so nothing already in a deployment is retired by the migration', async () => {
        await db.insert(schema.templates).values({
            id: 'tpl-plain', tenantId: TENANT, name: 'Standard Residential',
            schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(),
        });
        const row = await db.select().from(schema.templates).get();
        expect(row?.retiredAt).toBeNull();
    });
});
