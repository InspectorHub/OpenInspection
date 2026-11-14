/**
 * What actually lands in the database for template documents.
 *
 * `templates.schema` and `inspections.template_snapshot` are JSON-mode text
 * columns: the driver serialises on write and parses on read. A writer that
 * stringifies first stores a JSON string literal (json_type 'text') instead of
 * the document (json_type 'object'). Reading through drizzle parses once more
 * and hides the difference, so every assertion here asks SQLite directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { TemplateService } from '../../../server/services/template.service';
import { drizzle } from 'drizzle-orm/d1';
import { insertLocalTemplate } from '../../../server/services/marketplace/local-template';
import { TemplateSeedService } from '../../../server/services/template-seed.service';
import { seedStarterContent } from '../../../server/services/starter-content.service';
import { InspectionResultsService } from '../../../server/services/inspection/inspection-results.service';

const TENANT = '00000000-0000-0000-0000-0000000000a1';

const V2 = {
    schemaVersion: 2 as const,
    sections: [{ id: 's1', title: 'Roof', items: [{ id: 'i1', label: 'Cover', type: 'text' as const }] }],
};

describe('stored shape of template documents', () => {
    let sqlite: SqliteDatabase;
    let d1: D1Database;
    let svc: TemplateService;

    /** [json_type, count] pairs for a column, via SQLite itself. */
    const shapes = (table: string, column: string, where = '1=1'): Record<string, number> => {
        const rows = sqlite.prepare(`SELECT json_type(${column}) AS t, count(*) AS n FROM ${table} WHERE ${where} GROUP BY 1`)
            .all() as Array<{ t: string | null; n: number }>;
        return Object.fromEntries(rows.map((r) => [String(r.t), r.n]));
    };

    beforeEach(async () => {
        const made = createTestDb();
        sqlite = made.sqlite;
        await setupSchema(sqlite);
        await made.db.insert(schema.tenants).values({
            id: TENANT, slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        d1 = toD1Binding(sqlite);
        svc = new TemplateService(d1);
    });

    it('createTemplate stores the document, not a string wrapping it', async () => {
        const row = await svc.createTemplate(TENANT, 'New', V2);
        expect(shapes('templates', 'schema', `id='${row.id}'`)).toEqual({ object: 1 });
        expect(row.schema).toStrictEqual(V2);
    });

    it('updateTemplate with a schema stores the document', async () => {
        const row = await svc.createTemplate(TENANT, 'New', V2);
        await svc.updateTemplate(row.id, TENANT, 'Renamed', { ...V2, sections: [] });
        expect(shapes('templates', 'schema', `id='${row.id}'`)).toEqual({ object: 1 });
    });

    it('a rename alone heals a row an older writer double-encoded', async () => {
        sqlite.prepare('INSERT INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?,?,?,?,?,?)')
            .run('old', TENANT, 'Old', 1, JSON.stringify(JSON.stringify(V2)), Date.now());
        expect(shapes('templates', 'schema')).toEqual({ text: 1 });
        await svc.updateTemplate('old', TENANT, 'Old renamed');
        expect(shapes('templates', 'schema')).toEqual({ object: 1 });
        const stored = JSON.parse((sqlite.prepare("SELECT schema FROM templates WHERE id='old'").get() as { schema: string }).schema);
        expect(stored).toStrictEqual(V2);
    });

    it('a rename leaves an object row an object', async () => {
        const row = await svc.createTemplate(TENANT, 'New', V2);
        await svc.updateTemplate(row.id, TENANT, 'Again');
        expect(shapes('templates', 'schema')).toEqual({ object: 1 });
    });

    it('the bundled template seed stores documents', async () => {
        const out = await new TemplateSeedService(d1).bulkSeed(TENANT);
        expect(out.seeded).toBeGreaterThan(0);
        // Printed beside the row count so an empty table cannot pass.
        expect(shapes('templates', 'schema')).toEqual({ object: out.seeded });
    });

    it('starter content stores documents', async () => {
        await seedStarterContent(d1, TENANT);
        const total = (sqlite.prepare('SELECT count(*) AS n FROM templates').get() as { n: number }).n;
        expect(total).toBeGreaterThan(0);
        expect(shapes('templates', 'schema')).toEqual({ object: total });
    });

    it('switchRatingSystem works on an object snapshot and on an older wrapped one', async () => {
        await seedStarterContent(d1, TENANT);
        const system = sqlite.prepare('SELECT id FROM rating_systems WHERE tenant_id = ? LIMIT 1').get(TENANT) as { id: string };
        const insert = sqlite.prepare('INSERT INTO inspections (id, tenant_id, property_address, date, template_snapshot, created_at) VALUES (?,?,?,?,?,?)');
        insert.run('obj', TENANT, '1 Main', '2026-01-01', JSON.stringify(V2), Date.now());
        insert.run('wrapped', TENANT, '2 Main', '2026-01-01', JSON.stringify(JSON.stringify(V2)), Date.now());
        const results = new InspectionResultsService(d1);
        await results.switchRatingSystem('obj', TENANT, system.id, 'clear');
        await results.switchRatingSystem('wrapped', TENANT, system.id, 'clear');
        // Both end as documents that keep the original sections and carry a rating system.
        expect(shapes('inspections', 'template_snapshot')).toEqual({ object: 2 });
        for (const id of ['obj', 'wrapped']) {
            const row = sqlite.prepare('SELECT template_snapshot AS s FROM inspections WHERE id = ?').get(id) as { s: string };
            const doc = JSON.parse(row.s) as { sections: unknown[]; ratingSystem?: unknown };
            expect(doc.sections).toHaveLength(1);
            expect(doc.ratingSystem).toBeTruthy();
        }
    });

    it('insertLocalTemplate stores an object even when handed a string document', async () => {
        const now = new Date();
        const db = drizzle(d1) as unknown as Parameters<typeof insertLocalTemplate>[0];
        const fromString = await insertLocalTemplate(db, TENANT, 'From string', JSON.stringify(V2), now);
        const fromObject = await insertLocalTemplate(db, TENANT, 'From object', V2, now);
        expect(shapes('templates', 'schema', `id IN ('${fromString}','${fromObject}')`)).toEqual({ object: 2 });
    });

    it('updateTemplateSnapshot stores the document', async () => {
        await seedStarterContent(d1, TENANT);
        sqlite.prepare('INSERT INTO inspections (id, tenant_id, property_address, date, created_at) VALUES (?,?,?,?,?)')
            .run('insp', TENANT, '1 Main', '2026-01-01', Date.now());
        await new InspectionResultsService(d1).updateTemplateSnapshot('insp', TENANT, V2);
        expect(shapes('inspections', 'template_snapshot', "id='insp'")).toEqual({ object: 1 });
    });
});
