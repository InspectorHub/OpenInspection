/**
 * The starter contacts spreadsheet — and the proof that it is DERIVED.
 *
 * The template exists to delete one failure: an operator uploads a contacts
 * file whose columns are spelled in a way the importer does not recognise, and
 * every row lands unmapped. A file whose headings the importer already reads
 * cannot fail that way.
 *
 * Which makes the template's ONE real risk a drift: a hand-written header list
 * that was correct on the day it was typed and silently stops matching the
 * parser the first time somebody edits the vocabulary. So the assertions here
 * are not mostly about today's four columns. They are about the derivation —
 * the vocabulary is fed in, and the template has to move with it, in both
 * directions:
 *
 *   - a spelling the importer knows is picked up (the header CHANGES);
 *   - a spelling the importer does not know is dropped (the column GOES);
 *   - a field in the vocabulary that the CONTACTS mapping never binds never
 *     appears, however loudly the vocabulary lists it.
 *
 * Every one of those is paired with a positive control in the same result, so
 * "the column is absent" can never pass because the builder returned nothing.
 */
import { describe, it, expect } from 'vitest';
import {
    CONTACTS_TEMPLATE_FILE_NAME,
    buildContactsTemplateCsv,
    contactsTemplateColumns,
    type IntakeHeaderVocabulary,
} from '../../../server/lib/migration-intake/contacts-template';
import {
    defaultMappingFor,
    intakeSourceFromText,
    matchAdapter,
} from '../../../server/lib/migration-intake/adapters/registry';
import { parseCsvTable } from '../../../server/lib/migration-intake/csv';

/** Just the header strings, in the order the file carries them. */
function headers(vocabulary?: IntakeHeaderVocabulary): string[] {
    return contactsTemplateColumns(vocabulary).map((c) => c.header);
}

/** The header row and the example row, tokenised by the importer's own reader. */
function readBack(csv: string): { columns: string[]; rows: Record<string, string>[] } {
    const table = parseCsvTable(csv);
    return { columns: table.columns, rows: table.rows };
}

describe('contacts template — which columns it carries', () => {
    it('carries the fields the contacts mapping binds, and nothing else', () => {
        expect(headers()).toEqual(['name', 'email', 'phone', 'agency']);
    });

    it('leaves out a vocabulary field the contacts mapping never binds', () => {
        // `role` is in the shared vocabulary — the TEAM-MEMBER entry point reads
        // it — and the contacts mapping does not. A template offering a column
        // the contacts importer ignores teaches a format it does not have.
        expect(headers()).not.toContain('role');
        // The positive control: the same lookup, in the same result, finding a
        // field that IS bound. Without it, "role is absent" would also pass on
        // an empty list.
        expect(headers()).toContain('agency');
    });

    it('names each column with the spelling the importer prefers', () => {
        // `pickColumn` scans a field's aliases IN ORDER and takes the first one
        // present, so the first alias is not an arbitrary pick — it is the
        // spelling the importer itself resolves to when a file offers several.
        const vocabulary: IntakeHeaderVocabulary = {
            name: ['contact name', 'name'],
            email: ['email'],
        };
        expect(headers(vocabulary)).toEqual(['contact name', 'email']);
    });
});

describe('contacts template — the derivation is live', () => {
    it('follows the vocabulary when a field is respelled', () => {
        // `email address` is a real alias of the real vocabulary, so the
        // importer still binds it — and the template has to say so.
        const vocabulary: IntakeHeaderVocabulary = {
            name: ['name'],
            email: ['email address'],
        };
        expect(headers(vocabulary)).toEqual(['name', 'email address']);
        // Positive control: the unchanged field is still spelled the old way,
        // so the assertion above is about `email` and not about the builder
        // rewriting everything.
        expect(headers(vocabulary)).toContain('name');
    });

    it('drops a field whose spelling the importer would not recognise', () => {
        const vocabulary: IntakeHeaderVocabulary = {
            name: ['name'],
            email: ['electronic mail'],
        };
        // Nothing in the importer matches `electronic mail`, so a template
        // offering it would hand the operator a column that imports nothing.
        expect(headers(vocabulary)).not.toContain('electronic mail');
        expect(headers(vocabulary)).toEqual(['name']);
    });

    it('ignores a field invented in the vocabulary that no mapping reads', () => {
        const vocabulary: IntakeHeaderVocabulary = {
            name: ['name'],
            nickname: ['nickname'],
        };
        expect(headers(vocabulary)).toEqual(['name']);
    });

    it('follows the vocabulary when the fields are reordered', () => {
        const vocabulary: IntakeHeaderVocabulary = {
            agency: ['agency'],
            name: ['name'],
        };
        expect(headers(vocabulary)).toEqual(['agency', 'name']);
    });
});

describe('contacts template — the file', () => {
    it('is one header row and one example row', () => {
        const { columns, rows } = readBack(buildContactsTemplateCsv());
        expect(columns).toEqual(['name', 'email', 'phone', 'agency']);
        expect(rows).toHaveLength(1);
    });

    it('fills the example row with values that cannot be mistaken for a person', () => {
        const { rows } = readBack(buildContactsTemplateCsv());
        // Reserved by standard, not merely made up: `example.com` is reserved
        // for documentation (RFC 2606) and `555-0100` sits in the North
        // American range set aside for fiction. Neither can reach anybody.
        expect(rows[0].email).toBe('contact@example.com');
        expect(rows[0].phone).toBe('555-0100');
        expect(rows[0].name).toContain('Example');
    });

    it('keeps each example value under its own field when the columns move', () => {
        const columns = contactsTemplateColumns({ agency: ['agency'], name: ['name'] });
        const { rows } = readBack(buildContactsTemplateCsv(columns));
        // Aligned by FIELD, not by position: a row built by index would put the
        // name in the agency column the moment the vocabulary is reordered.
        expect(rows[0].agency).toBe('Example Agency');
        expect(rows[0].name).toContain('Example');
    });

    it('leaves a cell empty rather than guessing when a column has no example', () => {
        const { rows } = readBack(
            buildContactsTemplateCsv([{ field: 'name', header: 'name' }, { field: 'notes', header: 'notes' }]),
        );
        expect(rows[0].notes).toBe('');
        expect(rows[0].name).toContain('Example');
    });

    it('quotes a heading that would otherwise split into two columns', () => {
        const { columns } = readBack(
            buildContactsTemplateCsv([{ field: 'agency', header: 'Company, Inc' }]),
        );
        expect(columns).toEqual(['Company, Inc']);
    });

    it('starts with the first heading and no byte-order mark', () => {
        // A BOM is what a spreadsheet program writes by default and what would
        // make the first heading arrive with that mark glued to it — matched
        // by nothing, because the vocabulary is compared whole-cell.
        expect(buildContactsTemplateCsv().startsWith('name,')).toBe(true);
    });

    it('is named for what it is', () => {
        expect(CONTACTS_TEMPLATE_FILE_NAME).toBe('contacts-template.csv');
    });
});

describe('contacts template — the importer reads it back with nothing to map', () => {
    it('binds every column the template carries, unedited', async () => {
        const source = intakeSourceFromText(CONTACTS_TEMPLATE_FILE_NAME, buildContactsTemplateCsv());
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        if (!match) throw new Error('the template was not recognised as a spreadsheet at all');

        const mapping = defaultMappingFor('contacts.import', match.inspection, source);
        expect(mapping.kind).toBe('contacts');
        if (mapping.kind !== 'contacts') throw new Error('unreachable');
        expect(mapping.mapping.name).toBe('name');
        expect(mapping.mapping.email).toBe('email');
        expect(mapping.mapping.phone).toBe('phone');
        expect(mapping.mapping.agency).toBe('agency');
    });

    it('is the difference — the same rows under unrecognised headings map to nothing', async () => {
        // The negative control for the test above. This is the file the
        // template exists to replace: real data, headings nothing matches, and
        // a mapping the operator has to fill in by hand.
        const strange = 'col1,col2,col3\nExample Contact,contact@example.com,555-0100\n';
        const source = intakeSourceFromText('theirs.csv', strange);
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        if (!match) throw new Error('the fixture was not recognised as a spreadsheet at all');

        const mapping = defaultMappingFor('contacts.import', match.inspection, source);
        if (mapping.kind !== 'contacts') throw new Error('unreachable');
        expect(mapping.mapping.name).toBe('');
        expect(mapping.mapping.email).toBeUndefined();
    });
});
