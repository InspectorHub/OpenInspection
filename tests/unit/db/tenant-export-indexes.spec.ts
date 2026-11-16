/**
 * Every tenant-scoped table can be read one tenant at a time without touching
 * another tenant's rows.
 *
 * A full per-tenant export pages each table by its key
 * (`WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT n`). With only a
 * `(tenant_id)` index SQLite either sorts the whole tenant slice on every page or
 * walks the primary key across every tenant. Either way the work per page grows
 * with the size of the DATABASE rather than the size of the tenant. An index
 * whose leading columns are `(tenant_id, <paging key>)` turns the page into a
 * single seek plus a range read.
 *
 * Three things are asserted, each against the authority and not a literal list:
 *   1. the Drizzle schema (every table with a `tenant_id` column, enumerated at
 *      run time) declares such an index or primary key;
 *   2. the shipped migration set really creates it (the replayed database, not
 *      the schema object);
 *   3. SQLite's planner uses it, with no temp b-tree for the ORDER BY.
 *
 * The first check is a pure function over table objects, so it is also proven
 * red against a synthetic table that lacks the index.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { is } from 'drizzle-orm';
import {
    SQLiteTable, getTableConfig, sqliteTable, text, integer, index, primaryKey,
} from 'drizzle-orm/sqlite-core';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb } from '../db';

/**
 * One row per tenant: the primary key (or a plain unique index) is `tenant_id`
 * alone, so `WHERE tenant_id = ?` already hits at most one row through the key's
 * own index and a keyset page needs nothing more. Stated explicitly so a new table
 * cannot slip out of the check by being added here by accident: every name below
 * is also verified structurally to be a single-row-per-tenant table.
 */
const ONE_ROW_PER_TENANT: ReadonlySet<string> = new Set([
    'messaging_compliance',
    'qbo_connections',
    'tenant_ai_attestations',
    'tenant_ai_configs',
    'tenant_configs',
]);

type ColumnLike = { name?: string };

function colNames(cols: ReadonlyArray<ColumnLike>): string[] {
    // An expression key (`upper(code)`) has no column name. It can never match a
    // leading `tenant_id`, so it is spelled as a placeholder that cannot collide.
    return cols.map((c) => c.name ?? '<expression>');
}

interface Shape {
    table: string;
    /** The columns an export pages by, in key order, `tenant_id` excluded. */
    key: string[];
    /** Every full (non-partial) index, unique constraint and primary key, as column lists. */
    leading: string[][];
    oneRow: boolean;
}

function shapeOf(table: SQLiteTable): Shape | null {
    const cfg = getTableConfig(table);
    if (!cfg.columns.some((c) => c.name === 'tenant_id')) return null;

    const compositePk = cfg.primaryKeys[0] ? colNames(cfg.primaryKeys[0].columns) : null;
    const singlePk = cfg.columns.filter((c) => c.primary).map((c) => c.name);
    const pk = compositePk ?? singlePk;
    const key = compositePk ? compositePk.filter((c) => c !== 'tenant_id') : singlePk;

    // A partial index covers only some rows, so it cannot serve a full read of a tenant.
    const full = cfg.indexes.filter((i) => !i.config.where).map((i) => ({ cols: colNames(i.config.columns as ColumnLike[]), unique: !!i.config.unique }));
    const uniques = cfg.uniqueConstraints.map((u) => ({ cols: colNames(u.columns), unique: true }));
    const all = [...full, ...uniques];

    const oneRow = (pk.length === 1 && pk[0] === 'tenant_id')
        || all.some((i) => i.unique && i.cols.length === 1 && i.cols[0] === 'tenant_id');

    return {
        table: cfg.name,
        key,
        leading: [...all.map((i) => i.cols), pk],
        oneRow,
    };
}

function covers(shape: Shape): boolean {
    const want = ['tenant_id', ...shape.key];
    return shape.leading.some((cols) => want.every((w, i) => cols[i] === w));
}

/** Tables whose export paging has no `(tenant_id, key)` index, excluding one-row-per-tenant tables. */
export function exportPagingGaps(tables: ReadonlyArray<SQLiteTable>, oneRowAllowlist: ReadonlySet<string>): { checked: number; gaps: string[]; oneRow: string[] } {
    let checked = 0;
    const gaps: string[] = [];
    const oneRow: string[] = [];
    for (const t of tables) {
        const shape = shapeOf(t);
        if (!shape) continue;
        checked++;
        if (oneRowAllowlist.has(shape.table)) { oneRow.push(shape.table); continue; }
        if (!covers(shape)) gaps.push(`${shape.table} (needs tenant_id, ${shape.key.join(', ')})`);
    }
    return { checked, gaps, oneRow };
}

const tableSet = new Set<SQLiteTable>();
for (const v of Object.values(schema)) {
    if (typeof v === 'object' && v !== null && is(v, SQLiteTable)) tableSet.add(v);
}
const allTables: SQLiteTable[] = [...tableSet];

describe('tenant-scoped tables have a (tenant_id, key) index for export paging', () => {
    it('the checker finds a gap on a synthetic table without the index (red control)', () => {
        const bare = sqliteTable('synthetic_bare', {
            id: text('id').primaryKey(),
            tenantId: text('tenant_id').notNull(),
        }, (t) => [index('idx_synthetic_bare_tenant').on(t.tenantId)]);
        const result = exportPagingGaps([bare], new Set());
        expect(result.checked).toBe(1);
        expect(result.gaps).toEqual(['synthetic_bare (needs tenant_id, id)']);
    });

    it('the checker accepts the index, a composite primary key led by tenant_id, and rejects a partial index', () => {
        const withIdx = sqliteTable('synthetic_idx', {
            id: text('id').primaryKey(),
            tenantId: text('tenant_id').notNull(),
        }, (t) => [index('idx_synthetic_idx_tenant_id').on(t.tenantId, t.id)]);
        const compositePk = sqliteTable('synthetic_pk', {
            tenantId: text('tenant_id').notNull(),
            k: text('k').notNull(),
            n: integer('n').notNull(),
        }, (t) => [primaryKey({ columns: [t.tenantId, t.k, t.n] })]);
        const wrongOrder = sqliteTable('synthetic_order', {
            id: text('id').primaryKey(),
            tenantId: text('tenant_id').notNull(),
        }, (t) => [index('idx_synthetic_order_id_tenant').on(t.id, t.tenantId)]);
        expect(exportPagingGaps([withIdx, compositePk], new Set()).gaps).toEqual([]);
        expect(exportPagingGaps([wrongOrder], new Set()).gaps).toEqual(['synthetic_order (needs tenant_id, id)']);
    });

    it('every tenant table in the real schema is covered', () => {
        const { checked, gaps, oneRow } = exportPagingGaps(allTables, ONE_ROW_PER_TENANT);
        // Both numbers, every run: a zero checked count would make the next
        // assertion pass on an empty enumeration.
        console.log(`tenant tables checked: ${checked}; one-row-per-tenant allowlisted: ${oneRow.length}; gaps: ${gaps.length}`);
        expect(checked).toBeGreaterThan(90);
        expect(oneRow.length).toBe(ONE_ROW_PER_TENANT.size);
        expect(gaps, `add an index on (tenant_id, <key>) for: ${gaps.join('; ')}`).toEqual([]);
    });

    it('every allowlisted one-row-per-tenant table is structurally one row per tenant', () => {
        const byName = new Map(allTables.map((t) => [getTableConfig(t).name, t]));
        for (const name of ONE_ROW_PER_TENANT) {
            const t = byName.get(name);
            expect(t, `${name} is allowlisted but no longer exists`).toBeDefined();
            expect(shapeOf(t!)?.oneRow, `${name} is allowlisted but is not keyed by tenant_id alone`).toBe(true);
        }
    });

    it('index names are unique across the whole database and short enough to stay readable', () => {
        const seen = new Map<string, string>();
        const dup: string[] = [];
        let total = 0;
        let longest = 0;
        for (const t of allTables) {
            const cfg = getTableConfig(t);
            for (const i of cfg.indexes) {
                total++;
                longest = Math.max(longest, i.config.name.length);
                const prev = seen.get(i.config.name);
                if (prev) dup.push(`${i.config.name} on ${prev} and ${cfg.name}`);
                seen.set(i.config.name, cfg.name);
            }
        }
        console.log(`indexes declared: ${total}; longest name: ${longest}`);
        expect(total).toBeGreaterThan(200);
        expect(dup).toEqual([]);
        expect(longest).toBeLessThanOrEqual(64);
    });
});

describe('the shipped migrations create the export indexes and the planner uses them', () => {
    const { sqlite } = createTestDb();
    afterAll(() => { sqlite.close(); });

    interface IndexInfo { seqno: number; name: string }
    function leadingColumns(indexName: string): string[] {
        const cols = sqlite.prepare(`PRAGMA index_info(${JSON.stringify(indexName)})`).all() as IndexInfo[];
        return cols.sort((a, b) => a.seqno - b.seqno).map((c) => c.name);
    }

    it('the replayed database has an index (or primary key) leading with (tenant_id, key) for every tenant table', () => {
        const missing: string[] = [];
        let checked = 0;
        for (const t of allTables) {
            const shape = shapeOf(t);
            if (!shape || ONE_ROW_PER_TENANT.has(shape.table)) continue;
            checked++;
            const want = ['tenant_id', ...shape.key];
            const list = sqlite.prepare(`PRAGMA index_list(${JSON.stringify(shape.table)})`).all() as Array<{ name: string; partial: number }>;
            const viaIndex = list.some((ix) => !ix.partial && want.every((w, i) => leadingColumns(ix.name)[i] === w));
            if (!viaIndex) missing.push(shape.table);
        }
        console.log(`tables checked in the replayed database: ${checked}; missing: ${missing.length}`);
        expect(checked).toBeGreaterThan(90);
        expect(missing).toEqual([]);
    });

    function plan(sql: string, ...args: unknown[]): string[] {
        const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>;
        return rows.map((r) => r.detail);
    }

    // Representative shapes: a plain id key, a table that already had a tenant-only
    // index, a composite primary key whose order was not led by tenant_id, the
    // evidence log paged in chain order, and a text-key table.
    const cases: Array<{ name: string; sql: string; index: string; cols: string[]; range: string }> = [
        { name: 'inspections', sql: 'SELECT * FROM inspections WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT 500', index: 'idx_inspections_tenant_id', cols: ['tenant_id', 'id'], range: 'id>?' },
        { name: 'inspection_results', sql: 'SELECT * FROM inspection_results WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT 500', index: 'idx_inspection_results_tenant_id', cols: ['tenant_id', 'id'], range: 'id>?' },
        { name: 'audit_logs', sql: 'SELECT * FROM audit_logs WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT 500', index: 'idx_audit_logs_tenant_id', cols: ['tenant_id', 'id'], range: 'id>?' },
        { name: 'esign_audit_logs by id', sql: 'SELECT * FROM esign_audit_logs WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT 500', index: 'idx_esign_audit_logs_tenant_id', cols: ['tenant_id', 'id'], range: 'id>?' },
        { name: 'esign_audit_logs by (created_at, rowid)', sql: 'SELECT * FROM esign_audit_logs WHERE tenant_id = ? AND (created_at, rowid) > (?, ?) ORDER BY created_at, rowid LIMIT 500', index: 'idx_esign_audit_logs_tenant_created', cols: ['tenant_id', 'created_at'], range: '(created_at,rowid)>(?,?)' },
        { name: 'inspection_inspectors (composite key)', sql: 'SELECT * FROM inspection_inspectors WHERE tenant_id = ? AND (inspection_id, user_id) > (?, ?) ORDER BY inspection_id, user_id LIMIT 500', index: 'idx_inspection_inspectors_tenant_inspection_id_user_id', cols: ['tenant_id', 'inspection_id', 'user_id'], range: '(inspection_id,user_id)>(?,?)' },
        { name: 'tenant_slug_history', sql: 'SELECT * FROM tenant_slug_history WHERE tenant_id = ? AND old_slug > ? ORDER BY old_slug LIMIT 500', index: 'idx_tenant_slug_history_tenant_old_slug', cols: ['tenant_id', 'old_slug'], range: 'old_slug>?' },
    ];

    for (const c of cases) {
        it(`${c.name}: SEARCH using the new index, no temp b-tree`, () => {
            const placeholders = (c.sql.match(/\?/g) ?? []).length;
            const details = plan(c.sql, ...Array.from({ length: placeholders }, () => 'x'));
            const search = details.find((d) => d.startsWith('SEARCH'));
            expect(search, details.join(' | ')).toBeDefined();
            expect(search).toContain(`USING INDEX ${c.index}`);
            // Both the tenant and the paging column are in the index condition, so
            // the read is a seek plus a range, not a slice that is sorted afterwards.
            expect(search).toContain(`${c.cols[0]}=?`);
            expect(search).toContain(c.range);
            expect(details.filter((d) => d.includes('TEMP B-TREE'))).toEqual([]);
            expect(leadingColumns(c.index)).toEqual(c.cols);
        });
    }
});

/**
 * Single-column `(tenant_id)` indexes retired because a wider index on the same
 * table now leads with `tenant_id` and serves every query they served. SQLite can
 * seek on the leading column of a composite index, so the narrow one only cost a
 * written row per insert and delete. Listed by name so a later change cannot bring
 * one back unnoticed, and so each retirement is checked against the index that
 * replaced it rather than assumed.
 */
const RETIRED_TENANT_ONLY_INDEXES: ReadonlyArray<readonly [index: string, table: string]> = [
    ['idx_templates_tenant', 'templates'],
    ['idx_results_tenant', 'inspection_results'],
    ['idx_agreements_tenant', 'agreements'],
    ['idx_service_inspectors_tenant', 'service_inspectors'],
    ['idx_comments_tenant', 'comments'],
    ['idx_agreement_requests_tenant', 'agreement_requests'],
    ['idx_services_tenant', 'services'],
    ['idx_insp_services_tenant', 'inspection_services'],
    ['idx_discount_codes_tenant', 'discount_codes'],
    ['idx_automations_tenant', 'automations'],
    ['idx_media_pool_tenant', 'inspection_media_pool'],
    ['idx_tag_links_tenant', 'inspection_item_tag_links'],
    ['idx_defect_categories_tenant', 'defect_categories'],
    ['idx_reports_tenant', 'reports'],
    ['idx_inspector_credentials_tenant', 'inspector_credentials'],
    ['idx_contractor_types_tenant', 'contractor_types'],
    ['idx_report_pdfs_tenant', 'report_pdfs'],
    ['idx_crp_tenant', 'contact_role_profiles'],
    ['idx_ip_tenant', 'inspection_people'],
    ['idx_migration_rows_tenant', 'migration_rows'],
    ['idx_tenant_slug_history_tenant', 'tenant_slug_history'],
    ['idx_invites_tenant', 'tenant_invites'],
    ['idx_destruction_tenant', 'tenant_destruction_records'],
];

describe('retired single-column tenant indexes stay retired and are each replaced by a wider one', () => {
    const byName = new Map(allTables.map((t) => [getTableConfig(t).name, t]));

    it('the replacement check is red for a table whose only tenant index is the narrow one (control)', () => {
        const narrow = sqliteTable('synthetic_narrow', {
            id: text('id').primaryKey(),
            tenantId: text('tenant_id').notNull(),
        }, (t) => [index('idx_synthetic_narrow_tenant').on(t.tenantId)]);
        const shape = shapeOf(narrow)!;
        expect(covers(shape)).toBe(false);
    });

    it('none of the retired names is declared in the schema, and each table is still covered by a (tenant_id, key) index', () => {
        const declared = new Set<string>();
        for (const t of allTables) for (const i of getTableConfig(t).indexes) declared.add(i.config.name);
        const stillDeclared = RETIRED_TENANT_ONLY_INDEXES.filter(([n]) => declared.has(n)).map(([n]) => n);
        const uncovered: string[] = [];
        for (const [, table] of RETIRED_TENANT_ONLY_INDEXES) {
            const t = byName.get(table);
            const shape = t ? shapeOf(t) : null;
            if (!shape || !covers(shape)) uncovered.push(table);
        }
        console.log(`retired names: ${RETIRED_TENANT_ONLY_INDEXES.length}; still declared: ${stillDeclared.length}; tables without a covering index: ${uncovered.length}`);
        expect(RETIRED_TENANT_ONLY_INDEXES.length).toBe(23);
        expect(stillDeclared).toEqual([]);
        expect(uncovered).toEqual([]);
    });

    it('none of the retired names exists in the replayed database, and the covering index does', () => {
        const { sqlite } = createTestDb();
        try {
            const names = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name));
            expect(names.size).toBeGreaterThan(200);
            expect(RETIRED_TENANT_ONLY_INDEXES.filter(([n]) => names.has(n)).map(([n]) => n)).toEqual([]);
            for (const [, table] of RETIRED_TENANT_ONLY_INDEXES) {
                const list = sqlite.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as Array<{ name: string; partial: number }>;
                const lead = list.filter((ix) => !ix.partial).some((ix) => {
                    const cols = sqlite.prepare(`PRAGMA index_info(${JSON.stringify(ix.name)})`).all() as Array<{ seqno: number; name: string }>;
                    const first = cols.sort((a, b) => a.seqno - b.seqno)[0];
                    return first?.name === 'tenant_id' && cols.length > 1;
                });
                expect(lead, `${table} lost its tenant-leading index`).toBe(true);
            }
        } finally { sqlite.close(); }
    });
});
