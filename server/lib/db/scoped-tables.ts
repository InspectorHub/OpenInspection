import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

/**
 * Every Drizzle `SQLiteTable` export whose columns include `prop`, minus the
 * table names in `exclude`. Deriving cascade/purge sets from the schema (instead
 * of a hand-maintained list) means they can never silently drift as new tables
 * are added — the previous static lists omitted whole tables and leaked PII.
 */
function tablesWithColumn(prop: string, exclude: Set<string> = new Set()): SQLiteTable[] {
    return (Object.values(schema) as unknown[])
        .filter((t): t is SQLiteTable => is(t, SQLiteTable))
        .filter((t) => prop in getTableColumns(t))
        .filter((t) => !exclude.has(getTableName(t)));
}

// `tenant_destruction_records` carries a `tenant_id` snapshot but is the durable,
// non-personal compliance proof — it MUST survive a tenant purge.
export const tenantScopedTables = (): SQLiteTable[] =>
    tablesWithColumn('tenantId', new Set(['tenant_destruction_records']));

// Tables owned by a single inspection (every table with an `inspection_id`
// column). Used by the inspection-delete cascade. `inspections` itself is keyed
// by `id`, not `inspection_id`, so it is not in this set and is deleted last.
//
// `offline_import_applied` is excluded on purpose: its `inspection.create` rows
// are how a repeat import of an offline package learns that an inspection it
// would create was created before and then deliberately deleted. Deleting the
// record with the inspection would let that package bring it back. The rows hold
// ids only, and a tenant purge still removes them (they carry `tenant_id`).
export const inspectionScopedTables = (): SQLiteTable[] =>
    tablesWithColumn('inspectionId', new Set(['offline_import_applied']));
