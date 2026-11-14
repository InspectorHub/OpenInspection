/**
 * The templates.schema unwrap migration must not change the content hash of a
 * report whose template row was still stored wrapped (the migration plan's
 * 4.3(a) acceptance check).
 *
 * `getReportContentHash` is the render-cache and translation-freshness basis
 * (report-grain.ts): a change here re-renders every cached PDF of such a report
 * once, for no content change at all. The fixture is the pre-fix world — the
 * template row AND the inspection snapshot stored as a JSON string literal
 * wrapping the document — because that is the world the migration runs in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';

const TENANT = 't-hash';
const DOC = {
    schemaVersion: 2,
    sections: [{ id: 's1', title: 'Roof', items: [{ id: 'i1', label: 'Cover', type: 'text' }] }],
};
const WRAPPED = JSON.stringify(JSON.stringify(DOC));

// Matched by suffix, not sequence number: migration files renumber on consolidation.
const migrationSql = import.meta.glob('../../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const UNWRAP = Object.entries(migrationSql).find(([key]) => key.endsWith('_templates_schema_unwrap.sql'))![1];

describe('the unwrap migration leaves the report content hash alone', () => {
    let sqlite: SqliteDatabase;
    let inspection: InspectionService;

    beforeEach(async () => {
        const made = createTestDb();
        sqlite = made.sqlite;
        await setupSchema(sqlite);
        testD1.use(made.db);
        await made.db.insert(schema.tenants).values({
            id: TENANT, slug: 'hash', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // Old-writer rows: the template schema and the inspection snapshot both stored wrapped.
        sqlite.prepare('INSERT INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?,?,?,?,?,?)')
            .run('tpl-wrapped', TENANT, 'Wrapped', 2, WRAPPED, 1700000000000);
        sqlite.prepare('INSERT INTO inspections (id, tenant_id, template_id, property_address, date, template_snapshot, created_at) VALUES (?,?,?,?,?,?,?)')
            .run('insp-1', TENANT, 'tpl-wrapped', '1 Main', '2026-01-01', WRAPPED, 1700000000000);
        inspection = new InspectionService(testD1.binding);
    });

    const shapeOfTemplate = () =>
        sqlite.prepare("SELECT json_type(schema) AS t FROM templates WHERE id='tpl-wrapped'").get() as { t: string };

    it('an unpublished inspection hashes the same before and after the migration', async () => {
        const before = await inspection.getReportContentHash('insp-1', TENANT);
        // The fixture must actually be in the pre-migration shape, or the check below is vacuous.
        expect(shapeOfTemplate().t).toBe('text');
        for (const stmt of UNWRAP.split('--> statement-breakpoint')) {
            if (stmt.trim()) sqlite.exec(stmt);
        }
        expect(shapeOfTemplate().t).toBe('object');
        const after = await inspection.getReportContentHash('insp-1', TENANT);
        expect(after).toBe(before);
    });

    it('control: a change to the snapshot DOES change the hash', async () => {
        const before = await inspection.getReportContentHash('insp-1', TENANT);
        sqlite.exec("UPDATE inspections SET template_snapshot = json_extract(template_snapshot, '$')");
        const after = await inspection.getReportContentHash('insp-1', TENANT);
        // Without this control, a getReportContentHash that ignored the snapshot
        // would satisfy the equality above while asserting nothing.
        expect(after).not.toBe(before);
    });
});
