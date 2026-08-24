/**
 * The starter spreadsheet — and the proof that it is DERIVED.
 *
 * The template exists to delete one failure: an operator uploads a file whose
 * columns are spelled in a way the importer does not recognise, and every row
 * lands unmapped. A file whose headings the importer already reads cannot fail
 * that way.
 *
 * Which makes the template's ONE real risk a drift: a hand-written header list
 * that was correct on the day it was typed and silently stops matching the
 * parser the first time somebody edits the vocabulary. So the assertions here
 * are not mostly about today's columns. They are about the derivation — a
 * vocabulary is fed in, and the template has to move with it, in both
 * directions:
 *
 *   - a spelling the importer knows is picked up (the header CHANGES);
 *   - a spelling the importer does not know is dropped (the column GOES);
 *   - a field the entity's OWN entry point never binds never appears, however
 *     loudly the vocabulary lists it.
 *
 * Every one of those is paired with a positive control in the same result, so
 * "the column is absent" can never pass because the builder returned nothing.
 */
import { describe, it, expect } from 'vitest';
import {
    CONTACTS_TEMPLATE_FILE_NAME,
    MEMBERS_TEMPLATE_FILE_NAME,
    boundHeaders,
    buildTemplateCsv,
    templateColumns,
} from '../../../server/lib/migration-intake/starter-template';
import { CONTACT_EXCHANGE } from '../../../server/lib/data-exchange/contacts';
import { MEMBER_EXCHANGE } from '../../../server/lib/data-exchange/members';
import type { ExchangeField, ExchangeVocabulary } from '../../../server/lib/data-exchange/types';
import {
    defaultMappingFor,
    intakeSourceFromText,
    matchAdapter,
} from '../../../server/lib/migration-intake/adapters/registry';
import { parseCsvTable } from '../../../server/lib/migration-intake/csv';

/** Just the header strings, in the order the file carries them. */
function headers(vocabulary: ExchangeVocabulary): string[] {
    return templateColumns(vocabulary).map((c) => c.header);
}

/** The header row and the example row, tokenised by the importer's own reader. */
function readBack(csv: string): { columns: string[]; rows: Record<string, string>[] } {
    const table = parseCsvTable(csv);
    return { columns: table.columns, rows: table.rows };
}

/**
 * A synthetic manifest, so the derivation can be driven with a vocabulary this
 * spec wrote. Feeding it the REAL one only ever shows that the two agree today.
 */
function vocabularyOf(
    entity: ExchangeVocabulary['entity'],
    intent: ExchangeVocabulary['intent'],
    spellings: Record<string, readonly string[]>,
): ExchangeVocabulary {
    const fields: ExchangeField[] = Object.entries(spellings).map(([field, aliases]) => ({
        field,
        column: field,
        header: aliases[0] ?? '',
        aliases,
        disposition: aliases.length > 0 ? 'roundTrip' : 'exportOnly',
        serialize: 'text',
        reason: 'a fixture',
    }));
    return { entity, intent, table: 'fixture', fields, notExported: [] };
}

const contactVocabulary = (spellings: Record<string, readonly string[]>) =>
    vocabularyOf('contact', 'contacts.import', spellings);

describe('starter template — which columns each entity carries', () => {
    it('carries the fields the contacts mapping binds, and nothing else', () => {
        // `type` and `notes` joined this list the day the contacts mapping
        // learned to bind them. Nobody edited the template to add them.
        expect(headers(CONTACT_EXCHANGE))
            .toEqual(['type', 'name', 'email', 'phone', 'agency', 'notes']);
    });

    it('carries the fields the MEMBER mapping binds, and nothing else', () => {
        expect(headers(MEMBER_EXCHANGE)).toEqual(['email', 'name', 'role']);
    });

    it('leaves out a field the OTHER entity reads', () => {
        // `phone` and `agency` belong to a contact and not to an invitation; a
        // members template offering them would teach a format it does not have.
        expect(headers(MEMBER_EXCHANGE)).not.toContain('phone');
        expect(headers(MEMBER_EXCHANGE)).not.toContain('agency');
        // The positive control, in the same result: the same lookup finding a
        // field that IS bound. Without it, "phone is absent" also passes on an
        // empty list.
        expect(headers(MEMBER_EXCHANGE)).toContain('role');
        // And the mirror: `role` is the members field, so it is not a contacts
        // column, while `agency` is.
        expect(headers(CONTACT_EXCHANGE)).not.toContain('role');
        expect(headers(CONTACT_EXCHANGE)).toContain('agency');
    });

    it('never offers a column an import can only ever ignore', () => {
        // `id` and `created_at` are exported and are not importable. A template
        // advertising them would ask the operator to fill in two cells nothing
        // reads.
        for (const f of CONTACT_EXCHANGE.fields.filter((x) => x.disposition === 'exportOnly')) {
            expect(headers(CONTACT_EXCHANGE)).not.toContain(f.header);
        }
        expect(headers(CONTACT_EXCHANGE).length).toBeGreaterThan(3);
    });

    it('names each column with the spelling the importer prefers', () => {
        // `pickColumn` scans a field's aliases IN ORDER and takes the first one
        // present, so the first alias is not an arbitrary pick — it is the
        // spelling the importer itself resolves to when a file offers several.
        expect(headers(contactVocabulary({ name: ['contact name', 'name'], email: ['email'] })))
            .toEqual(['contact name', 'email']);
    });
});

describe('starter template — the derivation is live', () => {
    it('follows the vocabulary when a field is respelled', () => {
        // `email address` is a real alias of the real vocabulary, so the
        // importer still binds it — and the template has to say so.
        const v = contactVocabulary({ name: ['name'], email: ['email address'] });
        expect(headers(v)).toEqual(['name', 'email address']);
        // Positive control: the unchanged field is still spelled the old way,
        // so the assertion above is about `email` and not about the builder
        // rewriting everything.
        expect(headers(v)).toContain('name');
    });

    it('drops a field whose spelling the importer would not recognise', () => {
        const v = contactVocabulary({ name: ['name'], email: ['electronic mail'] });
        // Nothing in the importer matches `electronic mail`, so a template
        // offering it would hand the operator a column that imports nothing.
        expect(headers(v)).not.toContain('electronic mail');
        expect(headers(v)).toEqual(['name']);
    });

    it('ignores a field invented in the vocabulary that no mapping reads', () => {
        expect(headers(contactVocabulary({ name: ['name'], nickname: ['nickname'] })))
            .toEqual(['name']);
    });

    it('follows the vocabulary when the fields are reordered', () => {
        expect(headers(contactVocabulary({ agency: ['agency'], name: ['name'] })))
            .toEqual(['agency', 'name']);
    });
});

describe('starter template — what counts as BOUND', () => {
    it('reads a fixed/column source as well as a plain column name', () => {
        // The contacts mapping answers `type` with `{ column: 'type' }`. A
        // filter that kept only string values would drop it silently, for the
        // wrong reason — the reason it used to give was that the file has no
        // column for a type at all, and that is no longer true.
        expect(boundHeaders({ name: 'name', type: { column: 'type' } }))
            .toEqual(new Set(['name', 'type']));
    });

    it('treats a FIXED answer as no column, because no column supplies it', () => {
        expect(boundHeaders({ name: 'name', type: { fixed: 'client' } }))
            .toEqual(new Set(['name']));
    });

    it('treats an empty column name as unanswered', () => {
        expect(boundHeaders({ name: '', email: 'email' })).toEqual(new Set(['email']));
    });
});

describe('starter template — the file', () => {
    it('is one header row and one example row, for each entity', () => {
        const contacts = readBack(buildTemplateCsv(CONTACT_EXCHANGE));
        expect(contacts.columns).toEqual(['type', 'name', 'email', 'phone', 'agency', 'notes']);
        expect(contacts.rows).toHaveLength(1);

        const members = readBack(buildTemplateCsv(MEMBER_EXCHANGE));
        expect(members.columns).toEqual(['email', 'name', 'role']);
        expect(members.rows).toHaveLength(1);
    });

    it('fills the example row with values that cannot be mistaken for a person', () => {
        const { rows } = readBack(buildTemplateCsv(CONTACT_EXCHANGE));
        // Reserved by standard, not merely made up: `example.com` is reserved
        // for documentation (RFC 2606) and `555-0100` sits in the North
        // American range set aside for fiction. Neither can reach anybody.
        expect(rows[0].email).toBe('contact@example.com');
        expect(rows[0].phone).toBe('555-0100');
        expect(rows[0].name).toContain('Example');
    });

    it('fills each example cell with a value that entity can actually take', () => {
        expect(readBack(buildTemplateCsv(CONTACT_EXCHANGE)).rows[0].type).toBe('client');
        expect(readBack(buildTemplateCsv(MEMBER_EXCHANGE)).rows[0].role).toBe('inspector');
        expect(readBack(buildTemplateCsv(MEMBER_EXCHANGE)).rows[0].email).toContain('@example.com');
    });

    it('keeps each example value under its own field when the columns move', () => {
        const v = contactVocabulary({ agency: ['agency'], name: ['name'] });
        const { rows } = readBack(buildTemplateCsv(CONTACT_EXCHANGE, templateColumns(v)));
        // Aligned by FIELD, not by position: a row built by index would put the
        // name in the agency column the moment the vocabulary is reordered.
        expect(rows[0].agency).toBe('Example Agency');
        expect(rows[0].name).toContain('Example');
    });

    it('leaves a cell empty rather than guessing when a column has no example', () => {
        const { rows } = readBack(buildTemplateCsv(CONTACT_EXCHANGE, [
            { field: 'name', header: 'name' },
            { field: 'invented', header: 'invented' },
        ]));
        expect(rows[0].invented).toBe('');
        expect(rows[0].name).toContain('Example');
    });

    it('quotes a heading that would otherwise split into two columns', () => {
        const { columns } = readBack(
            buildTemplateCsv(CONTACT_EXCHANGE, [{ field: 'agency', header: 'Company, Inc' }]),
        );
        expect(columns).toEqual(['Company, Inc']);
    });

    it('starts with the first heading and no byte-order mark', () => {
        // A BOM is what a spreadsheet program writes by default and what would
        // make the first heading arrive with that mark glued to it — matched
        // by nothing, because the vocabulary is compared whole-cell.
        expect(buildTemplateCsv(CONTACT_EXCHANGE).startsWith('type,')).toBe(true);
        expect(buildTemplateCsv(MEMBER_EXCHANGE).startsWith('email,')).toBe(true);
    });

    it('is named for what it is', () => {
        expect(CONTACTS_TEMPLATE_FILE_NAME).toBe('contacts-template.csv');
        expect(MEMBERS_TEMPLATE_FILE_NAME).toBe('members-template.csv');
    });
});

describe('starter template — the importer reads it back with nothing to map', () => {
    it('binds every column the contacts template carries, unedited', async () => {
        const source = intakeSourceFromText(
            CONTACTS_TEMPLATE_FILE_NAME, buildTemplateCsv(CONTACT_EXCHANGE),
        );
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        if (!match) throw new Error('the template was not recognised as a spreadsheet at all');

        const mapping = defaultMappingFor('contacts.import', match.inspection, source);
        if (mapping.kind !== 'contacts') throw new Error('unreachable');
        expect(mapping.mapping.name).toBe('name');
        expect(mapping.mapping.email).toBe('email');
        expect(mapping.mapping.phone).toBe('phone');
        expect(mapping.mapping.agency).toBe('agency');
        expect(mapping.mapping.notes).toBe('notes');
        expect(mapping.mapping.type).toEqual({ column: 'type' });
    });

    it('binds every column the MEMBERS template carries, unedited', async () => {
        const source = intakeSourceFromText(
            MEMBERS_TEMPLATE_FILE_NAME, buildTemplateCsv(MEMBER_EXCHANGE),
        );
        const match = await matchAdapter('members.invite', 'csv_generic', source);
        if (!match) throw new Error('the template was not recognised as a spreadsheet at all');

        const mapping = defaultMappingFor('members.invite', match.inspection, source);
        if (mapping.kind !== 'members') throw new Error('unreachable');
        expect(mapping.mapping.email).toBe('email');
        expect(mapping.mapping.name).toBe('name');
        expect(mapping.mapping.role).toEqual({ column: 'role' });
    });

    it('is the difference — the same rows under unrecognised headings map to nothing', async () => {
        // The negative control for the two tests above. This is the file the
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
