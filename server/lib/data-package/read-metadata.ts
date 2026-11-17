/**
 * Read metadata for the tenant data package's dumb Worker API.
 *
 * Layers on top of the table classification (1a), which remains the single
 * source of truth for WHICH tables and columns may travel. This module adds
 * the facts the paginated read endpoints need: the keyset a table is ordered
 * and cursor-paged on, which columns are large enough to need a chunked read,
 * and the per-page row/byte ceilings.
 *
 * It is derived from the live schema and classification rather than a
 * hand-maintained list: a new exportable table is covered automatically, and
 * the coverage spec fails if a table cannot be given a usable keyset. The one
 * documented exception is `esign_audit_logs`, whose evidence chain must be
 * read in `created_at, rowid` order (the chain is byte-for-byte, never
 * recomputed) rather than by its `id` primary key.
 */
import { getTableName, getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { CLASSIFICATION } from './classification';
import { columnDisposition, type ClassifiedTable } from './classification-types';

/** Which deployment profile the read is served under. */
export type ReadProfile = 'worker-free' | 'worker-paid';

/** A column that is large enough that a row read should be chunked, with its DB column name. */
export interface BlobColumn {
    readonly property: string;
    readonly name: string;
}

/** Everything the read endpoint needs for one exportable table. */
export interface TableReadMeta {
    readonly table: string;
    readonly disposition: 'export' | 'archive' | 'partial';
    /** DB column names of the keyset, in ORDER BY order. */
    readonly keyset: readonly string[];
    /** True when the keyset uses SQLite's implicit `rowid` (only esign_audit_logs). */
    readonly usesRowid: boolean;
    /** Whitelisted DB column names, in schema order. */
    readonly columns: readonly string[];
    /** Large columns that must be read via the chunk endpoint. */
    readonly blobColumns: readonly BlobColumn[];
    /** Columns whose stored JSON is returned verbatim, never normalized. */
    readonly rawJsonColumns: readonly string[];
}

/** Per-page ceilings. Free tier ≈96 KiB / 48 rows; paid ≈4 MiB / 1000 rows;
 *  tables carrying a large blob are cut to a quarter of the row budget. */
const PAGE_BUDGETS: Record<ReadProfile, { rows: number; bytes: number }> = {
    'worker-free': { rows: 48, bytes: 96 * 1024 },
    'worker-paid': { rows: 1000, bytes: 4 * 1024 * 1024 },
};

/** The documented keyset exception: the e-sign evidence chain is read in chain order. */
const KEYSET_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
    esign_audit_logs: ['created_at', 'rowid'],
};

/** Columns that hold a large payload and need a chunked read. Keyed by table name.
 *  `inspection_results.data` (results JSON) and `esign_audit_logs.payload_json`
 *  (evidence payload) can outgrow a page; `inspection_results.ydoc_state` is the
 *  schema's only true SQLite BLOB (the authoritative Yjs document). */
const BLOB_COLUMNS: Readonly<Record<string, readonly string[]>> = {
    inspection_results: ['data', 'ydoc_state'],
    esign_audit_logs: ['payload_json'],
};

/** JSON columns whose stored text must be returned exactly as stored (double-encoded JSON stays a string literal). */
const RAW_JSON_COLUMNS: Readonly<Record<string, readonly string[]>> = {
    inspection_results: ['data'],
};

function keysetFor(entry: ClassifiedTable): { keyset: string[]; usesRowid: boolean } {
    const tableName = getTableName(entry.table);
    const override = KEYSET_OVERRIDES[tableName];
    if (override) return { keyset: [...override], usesRowid: override.includes('rowid') };
    const cfg = getTableConfig(entry.table) as unknown as {
        columns: readonly { name: string; primary: boolean }[];
        primaryKeys: readonly { columns: readonly { name: string }[] }[];
    };
    const simple = cfg.columns.filter((c) => c.primary).map((c) => c.name);
    if (simple.length === 1) return { keyset: simple, usesRowid: false };
    if (cfg.primaryKeys.length === 1 && cfg.primaryKeys[0]!.columns.length > 0) {
        return { keyset: cfg.primaryKeys[0]!.columns.map((c) => c.name), usesRowid: false };
    }
    // No usable single/composite primary key: no deterministic keyset can be built.
    return { keyset: [], usesRowid: false };
}

/** All exportable tables' read metadata, derived from the classification + schema. */
export const TABLE_READ_META: readonly TableReadMeta[] = (() => {
    const out: TableReadMeta[] = [];
    for (const entry of CLASSIFICATION) {
        if (entry.disposition !== 'export' && entry.disposition !== 'archive' && entry.disposition !== 'partial') continue;
        const tableName = getTableName(entry.table);
        const cols = getTableColumns(entry.table) as Record<string, { name: string }>;
        const columns = Object.entries(cols)
            .filter(([prop]) => columnDisposition(entry, prop) === 'include')
            .map(([, col]) => col.name);
        const includedNames = new Set(columns);
        const blobProps = BLOB_COLUMNS[tableName] ?? [];
        const blobColumns: BlobColumn[] = Object.entries(cols)
            .filter(([, col]) => blobProps.includes(col.name) && includedNames.has(col.name))
            .map(([prop, col]) => ({ property: prop, name: col.name }));
        const rawJsonProps = RAW_JSON_COLUMNS[tableName] ?? [];
        const rawJsonColumns = Object.entries(cols)
            .filter(([, col]) => rawJsonProps.includes(col.name) && includedNames.has(col.name))
            .map(([, col]) => col.name);
        const { keyset, usesRowid } = keysetFor(entry);
        out.push({
            table: tableName,
            disposition: entry.disposition,
            keyset,
            usesRowid,
            columns,
            blobColumns,
            rawJsonColumns,
        });
    }
    return out;
})();

/** Lookup by table name. */
export const TABLE_READ_META_BY_NAME: ReadonlyMap<string, TableReadMeta> = new Map(
    TABLE_READ_META.map((m) => [m.table, m]),
);

/** Page ceilings for one table under a profile. A table with any large blob column gets a quarter of the row budget. */
export function pageCeilings(meta: TableReadMeta, profile: ReadProfile): { maxPageRows: number; maxPageBytes: number } {
    const base = PAGE_BUDGETS[profile];
    return {
        maxPageRows: meta.blobColumns.length > 0 ? Math.max(1, Math.floor(base.rows / 4)) : base.rows,
        maxPageBytes: base.bytes,
    };
}

/** Exportable tables that have no usable keyset — the coverage spec asserts this is empty. */
export const TABLES_WITHOUT_KEYSET: readonly string[] = TABLE_READ_META.filter((m) => m.keyset.length === 0).map((m) => m.table);
