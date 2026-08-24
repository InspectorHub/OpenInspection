/**
 * The interchange vocabulary for tenant data — one declaration per entity,
 * read by BOTH the CSV export and the import mapping.
 *
 * ── Why this is not inside the intake layer ─────────────────────────────────
 * The vocabulary is not about migration intake. It is what a tenant's data
 * looks like as a file, and the export that produces that file would still
 * exist if the import wizard were deleted tomorrow. Putting it here also keeps
 * the export from importing `migration-intake/adapters/registry`, whose import
 * graph drags a ZIP reader, an XLSX reader and a Java-serialisation reader into
 * anything that merely wants to write a CSV.
 *
 * ── Why a MANIFEST and not a denylist or an allowlist ───────────────────────
 * The same argument `server/lib/compliance/account-export-manifest.ts:15-46`
 * makes for the `users` row, and it is not re-argued here: a denylist is
 * complete by default and silently ships the next sensitive column, an
 * allowlist is safe and silently drops the next meaningful one. So every field
 * is CLASSIFIED — `roundTrip` or `exportOnly`, each with a reason — and every
 * remaining COLUMN of the table is listed in `notExported` with a reason.
 * Silence is not a decision, and `auditVocabularyCoverage` is what refuses to
 * let it be one.
 *
 * ── Purity ──────────────────────────────────────────────────────────────────
 * NOTHING in this directory imports the ORM, hono, the storage layer, a service
 * or an adapter. That is what lets a service and an adapter both read it:
 * `tests/unit/migration-intake/adapter-purity.spec.ts` forbids exactly those
 * specifiers inside `adapters/`, and the intake registry reaching through to a
 * module that imported drizzle would break that rule one hop out. Columns are
 * therefore named as string literals here, and the SPEC binds them to the live
 * Drizzle table with `getTableColumns` — the same split, for the same reason,
 * as `account-export-manifest.ts:66-74`.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATORS and INDEPENDENTLY
 * AUTHORED. The header spellings are ordinary English words for the fields a
 * contact list holds; the entity and intent words are our own.
 */
import { safeISODate } from '../date';

/** What an export does with a field, and whether an import can read it back. */
export type ExchangeDisposition = 'roundTrip' | 'exportOnly';

/** How a stored value becomes a cell. */
export type ExchangeSerializer = 'text' | 'isoTimestamp';

export interface ExchangeField {
    /** The DRIZZLE PROPERTY name on the selected row — the key the projection reads. */
    field: string;
    /** The DB column name, so an audit and this file speak the same vocabulary. */
    column: string;
    /** The heading the export writes, and the spelling an import resolves to. */
    header: string;
    /**
     * Every heading an import accepts for this field, PREFERRED FIRST.
     * MUST start with `header` when the disposition is `roundTrip`, and MUST be
     * empty when it is `exportOnly` — an alias for a field nothing can import
     * is a promise the mapper will not keep.
     */
    aliases: readonly string[];
    disposition: ExchangeDisposition;
    serialize: ExchangeSerializer;
    /** Why. For `exportOnly`, why an import may not read it back. */
    reason: string;
}

/** A column the export does not carry at all, and why it does not. */
export interface ExchangeOmission {
    column: string;
    reason: string;
}

export interface ExchangeVocabulary {
    /** Our own entity word. */
    entity: 'contact' | 'member';
    /** The intake entry point that reads this entity back. */
    intent: 'contacts.import' | 'members.invite';
    /** The table, for the coverage audit. */
    table: string;
    /** Every exported field, IN THE ORDER THE EXPORT WRITES THEM. */
    fields: readonly ExchangeField[];
    /** Columns deliberately NOT exported, each with a reason. Silence is not a decision. */
    notExported: readonly ExchangeOmission[];
}

export function exportHeaders(vocabulary: ExchangeVocabulary): string[] {
    return vocabulary.fields.map((f) => f.header);
}

export function roundTripFields(vocabulary: ExchangeVocabulary): ExchangeField[] {
    return vocabulary.fields.filter((f) => f.disposition === 'roundTrip');
}

/**
 * One cell, from the selected row.
 *
 * Keyed by the DRIZZLE PROPERTY rather than by position: a projection built by
 * index puts the agency under the name the moment the manifest is reordered,
 * and a reordered manifest is the thing this file exists to make safe.
 */
export function exportCell(row: Record<string, unknown>, field: ExchangeField): string {
    const value = row[field.field];
    if (value === null || value === undefined) return '';
    return field.serialize === 'isoTimestamp' ? safeISODate(value) : String(value);
}

/**
 * What the manifest and the live table disagree about, as sentences.
 *
 * Returns an EMPTY array for agreement, so the caller asserts on a list it can
 * print. Every complaint names the column, because a count tells a reader that
 * something is wrong and not which thing.
 */
export function auditVocabularyCoverage(
    vocabulary: ExchangeVocabulary,
    tableColumns: readonly string[],
): string[] {
    const ruled = new Set<string>([
        ...vocabulary.fields.map((f) => f.column),
        ...vocabulary.notExported.map((n) => n.column),
    ]);
    const complaints: string[] = [];
    for (const column of tableColumns) {
        if (!ruled.has(column)) {
            complaints.push(
                `${vocabulary.table}.${column} is neither exported nor listed in notExported with a reason`,
            );
        }
    }
    const live = new Set(tableColumns);
    for (const column of ruled) {
        if (!live.has(column)) {
            complaints.push(`${vocabulary.table}.${column} is ruled on but no longer exists`);
        }
    }
    return complaints;
}
