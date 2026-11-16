/**
 * Types and builders for the tenant data package classification.
 *
 * Every table in `server/lib/db/schema` carries exactly one entry, keyed by the
 * drizzle TABLE OBJECT (not its name), so removing or renaming a table is a
 * compile error here instead of a silent gap. The coverage spec in
 * `tests/unit/data-package/classification-coverage.spec.ts` enumerates the real
 * schema and fails on any table, or any column of a `partial` table, that has no
 * decision.
 *
 * Why a classification and not a denylist or an allowlist: a denylist leaks the
 * secret column added next month, an allowlist silently drops the personal-data
 * column added next month. Here a missing decision is a hard failure.
 *
 * What a column the classification has not seen resolves to differs by shape:
 * in a `partial` table it is WITHHELD; in a whole-table `export` / `archive`
 * table it is INCLUDED, because the table decides. That second case is guarded
 * by the column snapshot ratchet in the coverage spec: adding a column to such a
 * table changes the snapshot and fails the test until a person reviews it.
 */
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/** What happens to a table as a whole. */
type Disposition =
    /** Travels, and is imported as live records. */
    | 'export'
    /** Travels verbatim; imported only as a read-only archive (history, evidence). */
    | 'archive'
    /** Travels with a column-by-column decision (listed exhaustively). */
    | 'partial'
    /** Never travels: credentials, tokens, provider-bound registrations. */
    | 'withhold'
    /** Not tenant data: derived, transient, global, or bound to this deployment. */
    | 'out';

/**
 * How a table's rows are attributed to one tenant. The exporter filters on this,
 * so it is recorded per table and checked against the real schema.
 *  - `direct`: a NOT NULL `tenant_id` column.
 *  - `direct_nullable`: a `tenant_id` column that may be NULL (rows with NULL
 *    belong to no tenant and are never exported).
 *  - `tenant_row`: the `tenants` row itself, matched on `id`.
 *  - `global`: no tenant column at all; deployment-wide, never tenant data.
 */
type TenantScope = 'direct' | 'direct_nullable' | 'tenant_row' | 'global';

/**
 * A decision about one column of a `partial` table.
 *  - `'include'`: travels as is.
 *  - `{ include }`: travels as is although the NAME looks like a secret; the
 *    string says why it is public (checked by the secret-name guard).
 *  - `{ withhold }`: never travels; the string says why.
 *  - `{ reset }`: the importer replaces the value with a target-generated or
 *    neutral one; the source value is not trusted on the target.
 */
export type ColumnRule = 'include' | { include: string } | { withhold: string } | { reset: string };

type ColumnDisposition = 'include' | 'withhold' | 'reset' | 'out';

export interface ClassifiedTable {
    readonly table: SQLiteTable;
    readonly disposition: Disposition;
    readonly scope: TenantScope;
    readonly reason: string;
    /**
     * Per-column decisions keyed by drizzle PROPERTY name. For `partial` it is
     * exhaustive; for `export` / `archive` it lists only the exceptions
     * (withheld, reset or deliberately public columns); for `withhold` / `out`
     * it is empty because the table decides for every column.
     */
    readonly columns: Readonly<Record<string, ColumnRule>>;
    /** Properties named in more than one of withhold / reset / publicColumns (a mistake the validator reports). */
    readonly conflicts: readonly string[];
    /** Rows the exporter filters out of this table, when not all rows travel. */
    readonly rowFilter?: string;
}

type ColumnKey<T extends SQLiteTable> = keyof T['_']['columns'] & string;

/** Exceptions on a table that otherwise travels whole. */
interface Exceptions<T extends SQLiteTable> {
    readonly withhold?: Partial<Record<ColumnKey<T>, string>>;
    readonly reset?: Partial<Record<ColumnKey<T>, string>>;
    /** Columns whose name looks like a secret but which are public by design. */
    readonly publicColumns?: Partial<Record<ColumnKey<T>, string>>;
    /** Rows the exporter must leave out, in words (e.g. in-progress rows). Visible to the validator and the pin tests. */
    readonly rowFilter?: string;
}

function fromExceptions<T extends SQLiteTable>(ex: Exceptions<T> | undefined): { columns: Record<string, ColumnRule>; conflicts: string[]; rowFilter?: string } {
    const columns: Record<string, ColumnRule> = {};
    const conflicts: string[] = [];
    const put = (k: string, rule: ColumnRule): void => {
        if (k in columns) conflicts.push(k);
        columns[k] = rule;
    };
    for (const [k, v] of Object.entries(ex?.withhold ?? {})) put(k, { withhold: String(v) });
    for (const [k, v] of Object.entries(ex?.reset ?? {})) put(k, { reset: String(v) });
    for (const [k, v] of Object.entries(ex?.publicColumns ?? {})) put(k, { include: String(v) });
    return ex?.rowFilter === undefined ? { columns, conflicts } : { columns, conflicts, rowFilter: ex.rowFilter };
}

export function exportTable<T extends SQLiteTable>(table: T, scope: TenantScope, reason: string, ex?: Exceptions<T>): ClassifiedTable {
    return { table, disposition: 'export', scope, reason, ...fromExceptions(ex) };
}

export function archiveTable<T extends SQLiteTable>(table: T, scope: TenantScope, reason: string, ex?: Exceptions<T>): ClassifiedTable {
    return { table, disposition: 'archive', scope, reason, ...fromExceptions(ex) };
}

export function withholdTable<T extends SQLiteTable>(table: T, scope: TenantScope, reason: string): ClassifiedTable {
    return { table, disposition: 'withhold', scope, reason, columns: {}, conflicts: [] };
}

export function outTable<T extends SQLiteTable>(table: T, scope: TenantScope, reason: string): ClassifiedTable {
    return { table, disposition: 'out', scope, reason, columns: {}, conflicts: [] };
}

/**
 * A `partial` table lists EVERY column. The mapped type makes a column added to
 * the schema a compile error here, and the coverage spec makes it a test failure.
 */
export function partialTable<T extends SQLiteTable>(
    table: T,
    scope: TenantScope,
    reason: string,
    columns: Record<ColumnKey<T>, ColumnRule>,
): ClassifiedTable {
    return { table, disposition: 'partial', scope, reason, columns, conflicts: [] };
}

/** The decision for one column, resolved from the table entry. */
export function columnDisposition(entry: ClassifiedTable, property: string): ColumnDisposition {
    if (entry.disposition === 'withhold') return 'withhold';
    if (entry.disposition === 'out') return 'out';
    const rule = entry.columns[property];
    if (rule === undefined) return entry.disposition === 'partial' ? 'withhold' : 'include';
    if (rule === 'include' || 'include' in rule) return 'include';
    if ('reset' in rule) return 'reset';
    return 'withhold';
}
