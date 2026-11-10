/**
 * The templates.schema unwrap migration, against REAL D1 (workerd).
 *
 * Some template documents were stored as a JSON string literal wrapping the document
 * (json_type 'text') instead of the document (json_type 'object'). The migration unwraps those rows
 * and nothing else: not rows already stored correctly, not rows it cannot read, and not the
 * inspection snapshots or signed report versions that carry the same document.
 *
 * Both counts are printed and a zero is a failure: an empty fixture would make every "left alone" check true.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../server/lib/db/schema';
import { applyMigrations, flattenStatement } from './migration-replay';

const b = env as unknown as { DB: D1Database };
const migrationSql = import.meta.glob('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const UNWRAP = Object.entries(migrationSql).find(([key]) => key.endsWith('_templates_schema_unwrap.sql'))![1];

const TENANT = 'tenant-unwrap';
const DOC = { schemaVersion: 2, title: 'Residential', sections: [{ id: 's1', title: 'Roof', items: [] }] };
const DOC_TEXT = JSON.stringify(DOC);
const WRAPPED = JSON.stringify(DOC_TEXT);
const TRIPLE = JSON.stringify(WRAPPED);
const AWKWARD = { title: 'with "quotes" and \\ slashes and é', sections: [] };

const ROWS: Array<{ id: string; schema: string }> = [
    { id: 'wrapped-1', schema: WRAPPED },
    { id: 'wrapped-2', schema: JSON.stringify(JSON.stringify(AWKWARD)) },
    { id: 'object', schema: DOC_TEXT },
    { id: 'triple', schema: TRIPLE },
    { id: 'inner-not-json', schema: JSON.stringify('not json at all {') },
    { id: 'inner-array', schema: JSON.stringify('[1,2,3]') },
    { id: 'not-json', schema: 'plain text, not JSON' },
];

async function run(sql: string): Promise<void> {
    for (const stmt of sql.split('--> statement-breakpoint')) {
        const flat = flattenStatement(stmt);
        if (flat) await b.DB.exec(flat);
    }
}
async function schemaOf(id: string): Promise<string> {
    return (await b.DB.prepare('SELECT schema FROM templates WHERE id = ?').bind(id).first<{ schema: string }>())!.schema;
}
async function shapes(): Promise<Record<string, number>> {
    // json_type raises on invalid JSON, so guard it the same way the migration does.
    const res = await b.DB.prepare(
        "SELECT CASE WHEN json_valid(schema) THEN json_type(schema) ELSE 'invalid' END AS t, count(*) AS n FROM templates GROUP BY 1",
    ).all<{ t: string; n: number }>();
    return Object.fromEntries(res.results.map((r) => [r.t, r.n]));
}
async function fingerprint(): Promise<string> {
    const t = await b.DB.prepare('SELECT id, version, created_at, name FROM templates ORDER BY id').all();
    const i = await b.DB.prepare('SELECT id, template_snapshot FROM inspections ORDER BY id').all();
    const r = await b.DB.prepare('SELECT id, snapshot_json, content_hash, prev_hash, signature FROM report_versions ORDER BY id').all();
    return JSON.stringify([t.results, i.results, r.results]);
}

describe('templates.schema unwrap migration on real D1', () => {
    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
    });

    beforeEach(async () => {
        await b.DB.exec('DELETE FROM report_versions;');
        await b.DB.exec('DELETE FROM inspections;');
        await b.DB.exec('DELETE FROM templates;');
        const d = drizzle(b.DB);
        await d.insert(schema.tenants).values({
            id: TENANT, slug: 'unwrap', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        }).onConflictDoNothing();
        for (const r of ROWS) {
            await b.DB.prepare('INSERT INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?,?,?,?,?,?)')
                .bind(r.id, TENANT, r.id, 3, r.schema, 1700000000000).run();
        }
        // An inspection whose snapshot was copied from a wrapped template, and a signed version carrying it.
        await b.DB.prepare('INSERT INTO inspections (id, tenant_id, property_address, date, template_snapshot, created_at) VALUES (?,?,?,?,?,?)')
            .bind('insp-1', TENANT, '1 Main', '2026-01-01', WRAPPED, 1700000000000).run();
        await b.DB.prepare(
            'INSERT INTO report_versions (id, tenant_id, inspection_id, version_number, snapshot_json, content_hash, prev_hash, signature, published_at, published_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).bind('rv-1', TENANT, 'insp-1', 1, JSON.stringify({ inspection: { templateSnapshot: WRAPPED } }), 'hash-1', null, 'sig-1', 1700000000000, 'u1').run();
    });

    it('unwraps the wrapped rows to the exact document text and nothing else', async () => {
        const before = await shapes();
        console.log(`[gate] templates before: ${JSON.stringify(before)}`);
        // wrapped x2, triple, inner-not-json, inner-array are 'text'; the plain-text row is invalid JSON.
        expect(before.text).toBe(5);
        await run(UNWRAP);
        const after = await shapes();
        console.log(`[gate] templates after: ${JSON.stringify(after)}`);
        expect(await schemaOf('wrapped-1')).toBe(DOC_TEXT);
        expect(JSON.parse(await schemaOf('wrapped-2'))).toStrictEqual(AWKWARD);
        expect(await schemaOf('object')).toBe(DOC_TEXT);
        // Rows it cannot confidently unwrap are untouched, and the run did not abort on them.
        expect(await schemaOf('triple')).toBe(TRIPLE);
        expect(await schemaOf('inner-not-json')).toBe(JSON.stringify('not json at all {'));
        expect(await schemaOf('inner-array')).toBe(JSON.stringify('[1,2,3]'));
        expect(await schemaOf('not-json')).toBe('plain text, not JSON');
        expect(after.object).toBe((before.object ?? 0) + 2);
    });

    it('is idempotent: a second run changes nothing', async () => {
        await run(UNWRAP);
        const once = await fingerprint();
        const shapesOnce = await shapes();
        await run(UNWRAP);
        expect(await fingerprint()).toBe(once);
        expect(await shapes()).toEqual(shapesOnce);
    });

    it('touches no other column, and not the snapshot or the signed version', async () => {
        const before = JSON.parse(await fingerprint()) as unknown[][];
        await run(UNWRAP);
        const after = JSON.parse(await fingerprint()) as unknown[][];
        // templates: version, created_at and name identical (schema is not part of this fingerprint)
        expect(after[0]).toEqual(before[0]);
        // inspections and report_versions byte-identical, including the wrapped snapshot and the signature fields
        expect(after[1]).toEqual(before[1]);
        expect(after[2]).toEqual(before[2]);
        const insp = await b.DB.prepare("SELECT json_type(template_snapshot) AS t FROM inspections WHERE id='insp-1'").first<{ t: string }>();
        expect(insp!.t).toBe('text');
    });

    // Controls: prove the assertions above can fail.
    it('control: a migration widened to the snapshot column would be caught by the fingerprint', async () => {
        const before = await fingerprint();
        await b.DB.exec("UPDATE inspections SET template_snapshot = json_extract(template_snapshot, '$')");
        expect(await fingerprint()).not.toBe(before);
    });
    it('control: without the json_valid guards the statement aborts on non-JSON rows', async () => {
        await expect(b.DB.exec(
            "UPDATE templates SET schema = json_extract(schema, '$') WHERE json_type(schema) = 'text'",
        )).rejects.toThrow();
    });
});
