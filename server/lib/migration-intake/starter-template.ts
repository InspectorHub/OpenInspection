/**
 * The starter spreadsheet an operator downloads BEFORE uploading one.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Everything else in the intake path assumes the operator already holds an
 * export from some other product. Nothing told them what a well-formed file
 * looks like, so the commonest bad import was never a bad ROW — it was a whole
 * file whose headings nothing matched, which arrives as an entirely unmapped
 * upload and has to be repaired column by column. A file carrying headings the
 * importer already reads cannot fail that way.
 *
 * ── Why it is DERIVED and not typed out ─────────────────────────────────────
 * A hand-written header list is correct on the day it is written and wrong the
 * first time somebody edits the vocabulary — and wrong SILENTLY, because
 * nothing downstream reads this file. So the columns are computed from the two
 * facts that actually decide what the importer accepts:
 *
 *   1. the entity's `ExchangeVocabulary` — which fields exist, in which order,
 *      and which spellings mean which field;
 *   2. `defaultMappingFor(vocabulary.intent, …)` — which of those fields THAT
 *      entry point binds to a column at all.
 *
 * Both are read live. A field one entry point binds and the other does not —
 * `agency` for a contact, `role` for an invitation — is included or excluded by
 * construction rather than by being remembered, and a field added to the
 * manifest appears here without anybody touching this file.
 *
 * ── One function, two entities ──────────────────────────────────────────────
 * The vocabulary is a PARAMETER, which is what lets the same derivation produce
 * the contacts file and the members file. It is also what lets a test drive it
 * with a manifest the test wrote — the only way to show that this file MOVES
 * with the vocabulary instead of merely agreeing with it on the day it was
 * written.
 *
 * ── Which spelling each column uses ─────────────────────────────────────────
 * A field has SEVERAL accepted spellings and one column can only show one. The
 * rule is the FIRST alias, and it is not arbitrary: `pickColumn` scans a
 * field's aliases in order and takes the first one present in the file, so the
 * first alias is precisely the spelling the importer resolves to when a file
 * offers more than one. Showing anything else would advertise a second-choice
 * spelling as the canonical form. A field with NO aliases is `exportOnly` — it
 * never reaches the file, because a column an import can only ignore is a cell
 * the operator would fill in for nothing.
 *
 * ── Why there is an example row ─────────────────────────────────────────────
 * Headings alone do not say that `agency` holds a firm and not a person, or
 * that a phone number may be written with punctuation. One row says both. The
 * risk it carries — somebody uploads the template untouched — is answered by
 * making the row unmistakably fictional rather than by leaving the file empty:
 * `example.com` is reserved for documentation (RFC 2606) and `555-0100` sits in
 * the North American range set aside for fiction, so neither can reach a real
 * person, and the run is previewed before anything is written anyway.
 */
import type { ExchangeVocabulary } from '../data-exchange/types';
import {
    defaultMappingFor,
    intakeSourceFromText,
} from './adapters/registry';

/** What each download is saved as. Also what the file calls itself in a report. */
export const CONTACTS_TEMPLATE_FILE_NAME = 'contacts-template.csv';
export const MEMBERS_TEMPLATE_FILE_NAME = 'members-template.csv';

/** One column of the template: the field it stands for, and its heading. */
export interface StarterTemplateColumn {
    /** The manifest's own field name — what the example row is keyed by. */
    field: string;
    /** The spelling written into the file. */
    header: string;
}

/**
 * The example values, keyed by ENTITY and then by FIELD rather than by
 * position.
 *
 * Keyed that way so a reordered or respelled vocabulary can never slide a name
 * into the agency column: the row is assembled by looking each column's field
 * up here, and a column with no entry gets an empty cell rather than whatever
 * value happened to sit at that index.
 *
 * The values are ours — written here to be recognisably fictional, not copied
 * out of anybody's export. `type` and `role` carry a value each entity can
 * actually take, because an example the importer would send to the repair
 * screen teaches the wrong thing twice over.
 */
const EXAMPLE_ROWS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    contact: {
        type: 'client',
        name: 'Example Contact',
        email: 'contact@example.com',
        phone: '555-0100',
        agency: 'Example Agency',
        notes: 'Prefers a morning appointment.',
    },
    member: {
        email: 'teammate@example.com',
        name: 'Example Teammate',
        role: 'inspector',
    },
};

/** What each entity's download is called. */
const FILE_NAMES: Readonly<Record<string, string>> = {
    contact: CONTACTS_TEMPLATE_FILE_NAME,
    member: MEMBERS_TEMPLATE_FILE_NAME,
};

/**
 * A cell, quoted only when it would otherwise be misread.
 *
 * Not dead code for a file of plain words: a heading comes from the vocabulary,
 * and the importer's own tokeniser understands a quoted heading — so an alias
 * containing a comma is a thing the importer can already match, and writing it
 * raw here would hand back a file that splits into the wrong number of columns.
 */
function csvCell(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The headers a mapping actually bound a column to.
 *
 * A mapping value is a column NAME, or a source that is either `{ column }` or
 * `{ fixed }`. All three shapes are read here, and that is load-bearing: the
 * contacts mapping answers `type` with `{ column: 'type' }` and the members
 * mapping answers `role` the same way, so a filter that kept only strings would
 * drop both silently — and for the wrong reason. The reason it used to give was
 * that the file has no column for a contact's type at all, which is no longer
 * true.
 *
 * A `{ fixed }` answer is deliberately NOT bound: no column supplies it, so a
 * template column for it would be a cell the importer ignores.
 */
export function boundHeaders(mapping: Record<string, unknown>): Set<string> {
    const bound = new Set<string>();
    for (const value of Object.values(mapping)) {
        if (typeof value === 'string') {
            if (value.length > 0) bound.add(value);
            continue;
        }
        if (value && typeof value === 'object' && 'column' in value) {
            const column = (value as { column: unknown }).column;
            if (typeof column === 'string' && column.length > 0) bound.add(column);
        }
    }
    return bound;
}

/**
 * The columns the template carries, in the manifest's own order.
 *
 * Derived in two steps, both live. First every field's preferred spelling is
 * offered to the entity's mapping as if it were the header row of a real
 * upload; then only the spellings the mapping actually BOUND to a column are
 * kept. A field it ignores, or a spelling it does not recognise, never reaches
 * the file — which is the whole point, because a column the importer would not
 * read is worse in a template than no column at all.
 */
export function templateColumns(vocabulary: ExchangeVocabulary): StarterTemplateColumn[] {
    const candidates: StarterTemplateColumn[] = [];
    for (const field of vocabulary.fields) {
        // `find` rather than `[0]`, so a field listed with no spellings is a
        // field with no column instead of an `undefined` heading handed to the
        // mapper — which is not a wrong answer there, it is a throw.
        const header = field.aliases.find((alias) => alias.length > 0);
        if (header) candidates.push({ field: field.field, header });
    }

    // The source is required by the signature and unread on these paths — the
    // contacts and members arms never look at the file, only at the columns.
    // Built rather than faked so this call stays the real one.
    const mapping = defaultMappingFor(
        vocabulary.intent,
        { kind: 'columns', columns: candidates.map((c) => c.header), sampleRows: [] },
        intakeSourceFromText(FILE_NAMES[vocabulary.entity] ?? 'template.csv', ''),
    );
    // Unreachable for these intents, and a refusal rather than a throw: a
    // template with no columns is a download somebody can look at and see is
    // wrong, where an exception on the way to a settings page is not.
    if (mapping.kind === 'template') return [];

    // Widened through `unknown` on purpose: `boundHeaders` reads the SHAPES a
    // mapping value can take rather than either entity's field names, which is
    // what lets one function serve both — and is precisely why the compiler
    // sees no overlap between a keyed mapping and a bare record.
    const bound = boundHeaders(mapping.mapping as unknown as Record<string, unknown>);
    return candidates.filter((c) => bound.has(c.header));
}

/**
 * The file, as text.
 *
 * No byte-order mark. A BOM is what a spreadsheet program writes by default and
 * would arrive back as part of the first heading — matched by nothing, since
 * the vocabulary is compared whole-cell — so the one file guaranteed to import
 * cleanly would be the one that did not.
 *
 * CRLF line endings, which is what RFC 4180 specifies and what the widest range
 * of spreadsheet software expects; our own reader takes either.
 */
export function buildTemplateCsv(
    vocabulary: ExchangeVocabulary,
    columns: StarterTemplateColumn[] = templateColumns(vocabulary),
): string {
    const example = EXAMPLE_ROWS[vocabulary.entity] ?? {};
    const headerRow = columns.map((c) => csvCell(c.header)).join(',');
    const exampleRow = columns.map((c) => csvCell(example[c.field] ?? '')).join(',');
    return `${headerRow}\r\n${exampleRow}\r\n`;
}
