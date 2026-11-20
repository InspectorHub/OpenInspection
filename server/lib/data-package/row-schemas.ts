/**
 * Strict per-table row schemas for the data-package importer.
 *
 * The shared package's `assertSafeJson` already refuses JSON that cannot be
 * restored faithfully (NUL, lone surrogates, __proto__, unsafe integers, deep
 * nesting). This layer adds the table-specific rules it cannot know: which
 * columns exist on this exportable table, and their scalar type. A row with a
 * withheld or unknown column is refused outright — the package's column
 * whitelist is derived from the same classification the exporter uses, so the
 * two cannot drift.
 *
 * Important boundary: `tenant_id` is a real column and is therefore accepted
 * here, but its VALUE is never trusted. The apply layer overwrites it from the
 * verified job's tenant. Similarly, id shape is not validated here — identity
 * semantics (keep-ids vs rewrite) belong to the apply layer, not to a JSON
 * type check.
 */
import { z } from 'zod';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { CLASSIFICATION } from './classification';
import { columnDisposition } from './classification-types';

/** The shape a BLOB column takes after the exporter JSON-encodes a Buffer. */
const bufferShape = z.object({
    type: z.literal('Buffer'),
    data: z.array(z.number().int().nonnegative()),
});

function zodForColumn(col: { dataType: string; mode?: string; notNull: boolean }): z.ZodTypeAny {
    // A stored JSON column and a text column both arrive as strings in a package
    // row (the exporter returns the stored text verbatim, see rawJsonColumns).
    let base: z.ZodTypeAny;
    switch (col.dataType) {
        case 'number':
        case 'date': // timestamp_ms columns are integers on the wire
            base = z.number();
            break;
        case 'boolean':
            base = z.boolean();
            break;
        case 'buffer':
            base = z.union([bufferShape, z.string()]);
            break;
        default: // string, json, bigint rendered as string, and any custom scalar
            base = z.string();
            break;
    }
    return col.notNull ? base : base.nullable().optional();
}

function buildSchemas(): Map<string, z.ZodTypeAny> {
    const out = new Map<string, z.ZodTypeAny>();
    for (const entry of CLASSIFICATION) {
        if (entry.disposition !== 'export' && entry.disposition !== 'partial') continue;
        const table = getTableName(entry.table);
        const columns = getTableColumns(entry.table) as Record<string, { name: string; dataType: string; mode?: string; notNull: boolean }>;
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [prop, col] of Object.entries(columns)) {
            if (columnDisposition(entry, prop) !== 'include') continue;
            shape[col.name] = zodForColumn(col);
        }
        out.set(table, z.object(shape).strict());
    }
    return out;
}

/** Table name -> strict row schema, for exactly the export/partial tables. */
export const ROW_SCHEMAS: ReadonlyMap<string, z.ZodTypeAny> = buildSchemas();

export function isRowTable(table: string): boolean {
    return ROW_SCHEMAS.has(table);
}

/** The exportable/partial table names that go through the row-apply path. */
export function rowTableNames(): string[] {
    return [...ROW_SCHEMAS.keys()];
}

export type RowValidation = { ok: true } | { ok: false; issues: string[] };

/** Validate one package row against its table's strict schema. */
export function validateRow(table: string, row: unknown): RowValidation {
    const schema = ROW_SCHEMAS.get(table);
    if (!schema) return { ok: false, issues: [`unknown or non-importable table: ${table}`] };
    const result = schema.safeParse(row);
    if (result.success) return { ok: true };
    return { ok: false, issues: result.error.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`) };
}
