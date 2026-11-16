/**
 * The rules the table classification must obey, as a pure function so the
 * coverage spec can run it against the real schema AND against synthetic
 * tables that prove each rule can fail.
 */
import { getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { columnDisposition, type ClassifiedTable } from '../../../server/lib/data-package/classification-types';

/** Column names that look like credentials. Included only with a stated public reason. */
export const SECRET_NAME = /(_enc$|token|secret|password|totp|recovery_code|credential|^dek|private_key|_iv$|api_key|apikey)/i;
/** Names that may never be included, whatever reason is given. */
export const NEVER_INCLUDE = /(_enc$|password|totp_secret|recovery_code|private_key|token_hash|^dek|_iv$)/i;

/**
 * Columns that hold personal or credential-like values inside a table that
 * otherwise travels whole. A whole-table export/archive of one of these tables
 * must name the column explicitly (withhold, reset, or a stated public reason)
 * so the decision is visible and reviewed.
 */
export const HIGH_RISK_COLUMNS: Readonly<Record<string, readonly string[]>> = {
    repair_requests: ['created_by_ref'],
    erasure_log: ['subject_email'],
    audit_logs: ['ip_address', 'platform_actor_id'],
    account_acceptances: ['actor_identity_ref'],
    contacts: ['agent_user_id', 'agent_linked_at', 'agent_revoked_at'],
    availability_overrides: ['source', 'external_id'],
    inspection_media_pool: ['stream_uid', 'provider'],
    report_views: ['access_token_id'],
    report_versions: ['verification_token'],
    agreement_requests: ['verification_token'],
};

type Cols = Record<string, AnyColumn>;

export interface ColumnSnapshotEntry { readonly columns: readonly string[] }

/** Sorted column names of every whole-table export/archive table. */
export function wholeTableColumnSnapshot(entries: readonly ClassifiedTable[]): Record<string, ColumnSnapshotEntry> {
    const out: Record<string, ColumnSnapshotEntry> = {};
    for (const e of entries) {
        if (e.disposition !== 'export' && e.disposition !== 'archive') continue;
        const names = Object.values(getTableColumns(e.table) as Cols).map((c) => c.name).sort();
        out[getTableName(e.table)] = { columns: names };
    }
    return out;
}

/** Fails when the real columns of a whole-table export/archive table no longer match the reviewed snapshot. */
export function compareColumnSnapshot(entries: readonly ClassifiedTable[], reviewed: Readonly<Record<string, ColumnSnapshotEntry>>): string[] {
    const problems: string[] = [];
    const now = wholeTableColumnSnapshot(entries);
    for (const [name, cur] of Object.entries(now)) {
        const was = reviewed[name];
        if (!was) problems.push(`${name}: whole-table table has no reviewed column snapshot`);
        else {
            const added = cur.columns.filter((c) => !was.columns.includes(c));
            const removed = was.columns.filter((c) => !cur.columns.includes(c));
            if (added.length > 0 || removed.length > 0) {
                problems.push(`${name}: column set changed (added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}); review, then update the snapshot`);
            }
        }
    }
    for (const name of Object.keys(reviewed)) if (!(name in now)) problems.push(`${name}: snapshot entry for a table that is not a whole-table export/archive`);
    return problems;
}

export function schemaTables(schemaModule: object): SQLiteTable[] {
    const seen = new Set<object>();
    const out: SQLiteTable[] = [];
    for (const value of Object.values(schemaModule)) {
        if (is(value, Table) && !seen.has(value)) {
            seen.add(value);
            out.push(value as SQLiteTable);
        }
    }
    return out;
}

export function columnCount(tables: readonly SQLiteTable[]): number {
    return tables.reduce((n, t) => n + Object.keys(getTableColumns(t)).length, 0);
}

export function validateClassification(
    entries: readonly ClassifiedTable[],
    tables: readonly SQLiteTable[],
    highRisk: Readonly<Record<string, readonly string[]>> = HIGH_RISK_COLUMNS,
): string[] {
    const problems: string[] = [];
    if (tables.length === 0) problems.push('0 schema tables seen: the enumeration is broken, not the classification');
    const classified = new Map<SQLiteTable, ClassifiedTable>();

    for (const e of entries) {
        const name = getTableName(e.table);
        if (classified.has(e.table)) problems.push(`${name}: classified twice`);
        classified.set(e.table, e);
        if (!tables.includes(e.table)) problems.push(`${name}: classified but not exported by the schema index`);
        if (e.reason.trim() === '') problems.push(`${name}: empty reason`);
        if (e.rowFilter !== undefined && e.rowFilter.trim() === '') problems.push(`${name}: empty rowFilter`);
    }
    const names = entries.map((e) => getTableName(e.table));
    for (const n of new Set(names.filter((x, i) => names.indexOf(x) !== i))) problems.push(`${n}: two entries share one table name`);

    for (const table of tables) {
        const name = getTableName(table);
        const entry = classified.get(table);
        if (!entry) { problems.push(`${name}: unclassified table`); continue; }
        const cols = getTableColumns(table) as Cols;

        for (const prop of entry.conflicts) problems.push(`${name}.${prop}: named in more than one of withhold / reset / publicColumns`);
        if (entry.disposition === 'export' || entry.disposition === 'archive') {
            for (const dbName of highRisk[name] ?? []) {
                const prop = Object.keys(cols).find((p) => cols[p]!.name === dbName);
                if (prop === undefined) problems.push(`${name}.${dbName}: high-risk column does not exist`);
                else if (!(prop in entry.columns)) problems.push(`${name}.${dbName}: high-risk column in a whole-table ${entry.disposition} needs an explicit exception`);
            }
        }
        for (const [prop, rule] of Object.entries(entry.columns)) {
            if (!(prop in cols)) { problems.push(`${name}.${prop}: classified column does not exist`); continue; }
            if (rule !== 'include' && Object.values(rule)[0]?.trim() === '') problems.push(`${name}.${prop}: empty reason`);
        }
        if ((entry.disposition === 'withhold' || entry.disposition === 'out') && Object.keys(entry.columns).length > 0) {
            problems.push(`${name}: a ${entry.disposition} table decides for every column; remove the column list`);
        }
        if (entry.disposition === 'partial') {
            for (const prop of Object.keys(cols)) {
                if (!(prop in entry.columns)) problems.push(`${name}.${cols[prop]!.name}: unclassified column in a partial table`);
            }
            if (!Object.values(entry.columns).some((r) => r !== 'include')) {
                problems.push(`${name}: partial but every column is included; use export or archive`);
            }
        }

        for (const [prop, col] of Object.entries(cols)) {
            if (columnDisposition(entry, prop) !== 'include') continue;
            const rule = entry.columns[prop];
            if (NEVER_INCLUDE.test(col.name)) problems.push(`${name}.${col.name}: credential-shaped column must never travel`);
            else if (SECRET_NAME.test(col.name) && !(typeof rule === 'object' && 'include' in rule)) {
                problems.push(`${name}.${col.name}: secret-looking column included without a stated public reason`);
            }
        }

        const tenantCol = Object.values(cols).find((c) => c.name === 'tenant_id');
        if (entry.scope === 'tenant_row') {
            if (name !== 'tenants') problems.push(`${name}: scope tenant_row is only for the tenants table`);
        } else if (entry.scope === 'global') {
            if (tenantCol) problems.push(`${name}: scope global but the table has a tenant_id column`);
        } else if (!tenantCol) {
            problems.push(`${name}: scope ${entry.scope} but the table has no tenant_id column`);
        } else if (entry.scope === 'direct' && !tenantCol.notNull) {
            problems.push(`${name}: scope direct but tenant_id is nullable`);
        } else if (entry.scope === 'direct_nullable' && tenantCol.notNull) {
            problems.push(`${name}: scope direct_nullable but tenant_id is NOT NULL`);
        }
        if (entry.disposition !== 'out' && entry.disposition !== 'withhold' && entry.scope === 'global') {
            problems.push(`${name}: ${entry.disposition} table with no tenant scoping would export other tenants data`);
        }
    }
    return problems;
}
