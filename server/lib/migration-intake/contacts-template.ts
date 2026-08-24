/**
 * The starter contacts spreadsheet an operator downloads BEFORE uploading one.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Everything else in the intake path assumes the operator already holds an
 * export from some other product. Nothing told them what a well-formed contacts
 * file looks like, so the commonest bad import was never a bad ROW — it was a
 * whole file whose headings nothing matched, which arrives as an entirely
 * unmapped upload and has to be repaired column by column. A file carrying
 * headings the importer already reads cannot fail that way.
 *
 * ── Why it is DERIVED and not typed out ─────────────────────────────────────
 * A hand-written header list is correct on the day it is written and wrong the
 * first time somebody edits the vocabulary — and wrong SILENTLY, because
 * nothing downstream reads this file. So the columns are computed from the two
 * facts that actually decide what the importer accepts:
 *
 *   1. `INTAKE_HEADERS` — which spellings mean which field;
 *   2. `defaultMappingFor('contacts.import', …)` — which of those fields the
 *      CONTACTS entry point binds to a column at all.
 *
 * Both are read live. A field the vocabulary lists but the contacts mapping
 * never binds — `role`, which belongs to the team-member entry point — is
 * excluded by construction rather than by being remembered, and a field added
 * to both appears here without anybody touching this file.
 *
 * ── Which spelling each column uses ─────────────────────────────────────────
 * A field has SEVERAL accepted spellings and one column can only show one. The
 * rule is the FIRST alias, and it is not arbitrary: `pickColumn` scans a field's
 * aliases in order and takes the first one present in the file, so the first
 * alias is precisely the spelling the importer resolves to when a file offers
 * more than one. Showing anything else would advertise a second-choice
 * spelling as the canonical form.
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
import { INTAKE_HEADERS, type IntakeHeaderVocabulary } from '../data-exchange/headers';
import {
    defaultMappingFor,
    intakeSourceFromText,
} from './adapters/registry';

/** What the download is saved as. Also what the file calls itself in a report. */
export const CONTACTS_TEMPLATE_FILE_NAME = 'contacts-template.csv';

/**
 * `IntakeHeaderVocabulary` is re-exported rather than declared: the shape now
 * belongs to `server/lib/data-exchange/headers.ts`, which is also where the one
 * dictionary is merged. Still taken as a PARAMETER below so the derivation can
 * be driven with a vocabulary a test writes — the only way to show that this
 * file MOVES with the vocabulary instead of merely agreeing with it on the day
 * it was written.
 */
export type { IntakeHeaderVocabulary };

/** One column of the template: the field it stands for, and its heading. */
export interface ContactsTemplateColumn {
    /** The vocabulary's own key — what the example row is keyed by. */
    field: string;
    /** The spelling written into the file. */
    header: string;
}

/**
 * The example values, keyed by FIELD rather than by position.
 *
 * Keyed that way so a reordered or respelled vocabulary can never slide a name
 * into the agency column: the row is assembled by looking each column's field
 * up here, and a column with no entry gets an empty cell rather than whatever
 * value happened to sit at that index.
 *
 * The values are ours — written here to be recognisably fictional, not copied
 * out of anybody's export.
 */
const EXAMPLE_ROW: Readonly<Record<string, string>> = {
    name: 'Example Contact',
    email: 'contact@example.com',
    phone: '555-0100',
    agency: 'Example Agency',
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
 * The columns the template carries, in the vocabulary's own order.
 *
 * Derived in two steps, both live. First every field's preferred spelling is
 * offered to the contacts mapping as if it were the header row of a real
 * upload; then only the spellings the mapping actually BOUND to a column are
 * kept. A field it ignores, or a spelling it does not recognise, never reaches
 * the file — which is the whole point, because a column the importer would not
 * read is worse in a template than no column at all.
 */
export function contactsTemplateColumns(
    vocabulary: IntakeHeaderVocabulary = INTAKE_HEADERS,
): ContactsTemplateColumn[] {
    const candidates: ContactsTemplateColumn[] = [];
    for (const [field, aliases] of Object.entries(vocabulary)) {
        // `find` rather than `[0]`, so a field listed with no spellings is a
        // field with no column instead of an `undefined` heading handed to the
        // mapper — which is not a wrong answer there, it is a throw.
        const header = aliases.find((alias) => alias.length > 0);
        if (header) candidates.push({ field, header });
    }

    // The source is required by the signature and unread on this path — the
    // contacts arm of `defaultMappingFor` never looks at the file, only at the
    // columns. Built rather than faked so this call stays the real one.
    const mapping = defaultMappingFor(
        'contacts.import',
        { kind: 'columns', columns: candidates.map((c) => c.header), sampleRows: [] },
        intakeSourceFromText(CONTACTS_TEMPLATE_FILE_NAME, ''),
    );
    // Unreachable for this intent, and a refusal rather than a throw: a
    // template with no columns is a download somebody can look at and see is
    // wrong, where an exception on the way to a settings page is not.
    if (mapping.kind !== 'contacts') return [];

    // A mapping value is either a column NAME or a fixed answer that no column
    // supplies — `type` is the fixed one, and it is excluded here for the same
    // reason the wizard does not ask about it: the file has no column for it.
    const bound = new Set(
        Object.values(mapping.mapping).filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
        ),
    );
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
export function buildContactsTemplateCsv(
    columns: ContactsTemplateColumn[] = contactsTemplateColumns(),
): string {
    const headerRow = columns.map((c) => csvCell(c.header)).join(',');
    const exampleRow = columns.map((c) => csvCell(EXAMPLE_ROW[c.field] ?? '')).join(',');
    return `${headerRow}\r\n${exampleRow}\r\n`;
}
