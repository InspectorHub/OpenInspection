/**
 * Which adapter reads this file, and what the wizard therefore has to ask.
 *
 * The VENDOR IS DECLARED by the caller, not derived from the entry point. The
 * question this layer answers is "is this file what you said it was", which has
 * a specific answer; "can anything read this" does not.
 *
 * What the wizard asks comes from which ARM the adapter reports — columns for a
 * tabular source, a rating vocabulary for a template — and `null` still means
 * "this adapter cannot read this file", which is a third thing again.
 *
 * The "I do not know what this is" entry never runs an adapter at all. It is
 * the entry point for a file nobody could classify, and having it guess would
 * be the same inference the whole design refuses everywhere else.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    ADAPTER_VENDORS,
    INTAKE_INTENTS,
    buildBundle,
    defaultMappingFor,
    intakeSourceFromBytes,
    intakeSourceFromText,
    matchAdapter,
    type AdapterMatch,
    type IntakeMapping,
    type IntakeSource,
} from '../../../server/lib/migration-intake/adapters/registry';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import type { VendorId } from '../../../server/lib/migration-intake/bundle';
import { zipOf } from '../helpers/zip-fixture';

const CONTACTS_CSV = [
    'Full Name,Email,Brokerage',
    'Alice Ng,alice@example.test,Acme Realty',
    'Bob Ray,bob@example.test,"Beta, Inc."',
].join('\n');

const HEADER = [
    'Section Name', 'Item Name', 'Comment Name', 'Comment Text',
    'Comment Type (info, limit, defect)',
];

function sheetXml(rows: string[][]): string {
    const cell = (v: string, col: number, row: number) =>
        `<c r="${String.fromCharCode(65 + col)}${row}" t="str"><v>${v}</v></c>`;
    const body = rows.map((r, i) =>
        `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join('')}</row>`).join('');
    return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * The template export, as the export button produces it: a workbook, one row
 * per canned comment, with the section and item repeated on every row.
 */
let SPECTORA_XLSX: Uint8Array;
const spectoraSource = (name = 'export.xlsx'): IntakeSource =>
    intakeSourceFromBytes(name, SPECTORA_XLSX);

beforeAll(async () => {
    SPECTORA_XLSX = await zipOf({
        'xl/worksheets/sheet1.xml': sheetXml([
            HEADER,
            ['Roof', 'Covering', 'Missing', 'Several are gone.', 'defect'],
        ]),
    });
});

describe('the registry table', () => {
    it('registers each adapter under the vendor that adapter says it reads', () => {
        // Not a count. A table keyed by vendor is only a lookup if the key and
        // the thing found under it agree about who it is; a mismatch here would
        // route a rebuild to the wrong adapter and still pass a size check.
        expect(Object.entries(ADAPTER_VENDORS).map(([key, adapter]) => [key, adapter?.name ?? null]))
            .toEqual([
                ['spectora', 'spectora'],
                ['home_inspector_pro', 'home-inspector-pro'],
                ['csv_generic', 'csv-generic'],
            ]);
        for (const [vendor, adapter] of Object.entries(ADAPTER_VENDORS)) {
            expect(adapter?.vendor).toBe(vendor);
        }
    });

    it('positive control: every intent that names an entity family resolves to a registered adapter', async () => {
        // An empty registry would satisfy every "unknown key finds nothing"
        // assertion in this file. This is the assertion it could not satisfy.
        const resolved: [string, string | null][] = [];
        for (const intent of INTAKE_INTENTS) {
            if (intent === 'assisted.full') continue;
            const isTemplate = intent.startsWith('templates.');
            const source: IntakeSource = isTemplate
                ? spectoraSource()
                : intakeSourceFromText('people.csv', CONTACTS_CSV);
            const vendor: VendorId = isTemplate ? 'spectora' : 'csv_generic';
            resolved.push([intent, (await matchAdapter(intent, vendor, source))?.adapterName ?? null]);
        }
        expect(resolved).toEqual([
            ['templates.create', 'spectora'],
            ['templates.overwrite', 'spectora'],
            ['contacts.import', 'csv-generic'],
            ['members.invite', 'csv-generic'],
        ]);
    });

    it('every stored intent is an intent the registry distinguishes', async () => {
        const { MIGRATION_INTENTS } = await import('../../../server/lib/db/schema');
        expect([...INTAKE_INTENTS].sort()).toEqual([...MIGRATION_INTENTS].sort());
    });
});

describe('matchAdapter', () => {
    it('matches a spreadsheet for a contact import and reports its columns', async () => {
        const match: AdapterMatch | null = await matchAdapter(
            'contacts.import', 'csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV),
        );
        expect(match?.vendor).toBe('csv_generic');
        expect(match?.adapterName).toBe(csvGenericAdapter.name);
        expect(match?.adapterVersion).toBe(csvGenericAdapter.version);
        // The arm, then its contents: a template arm carries neither, so
        // reading `columns` off an un-narrowed inspection would be reading a
        // field that may not be there.
        expect(match?.inspection?.kind).toBe('columns');
        if (match?.inspection?.kind !== 'columns') throw new Error('unreachable');
        expect(match.inspection.columns).toEqual(['Full Name', 'Email', 'Brokerage']);
        expect(match.inspection.sampleRows[0]).toEqual({
            'Full Name': 'Alice Ng', Email: 'alice@example.test', Brokerage: 'Acme Realty',
        });
    });

    it('matches a vendor export for a template import and reports a TEMPLATE, not columns', async () => {
        // This used to assert `inspection` was null, and read that as "a vendor
        // export has no columns, so the wizard has no question". That was true
        // about columns and false about the file: a template's question is what
        // its comment vocabulary means. The arm is what carries it.
        const match = await matchAdapter('templates.create', 'spectora', spectoraSource());
        expect(match?.vendor).toBe('spectora');
        expect(match?.adapterName).toBe(spectoraAdapter.name);
        expect(match?.inspection?.kind).toBe('template');
        if (match?.inspection?.kind !== 'template') throw new Error('unreachable');
        expect(match.inspection.sections).toBe(1);
        expect(match.inspection.ratings).toEqual(['info', 'limit', 'defect']);
        // Both adapters report; which ARM they report is what differs.
        expect(typeof spectoraAdapter.inspect).toBe('function');
        expect(typeof csvGenericAdapter.inspect).toBe('function');
    });

    // ⚠️ These two still pass and now mean something DIFFERENT. Before, the
    // intent picked the vendor and the file simply did not match it. Now the
    // operator's own declaration is what the file contradicts — which is what
    // makes a specific sentence possible. See `describeVendorMismatch` in
    // adapter-contract.spec.ts.
    it('does not match a spreadsheet declared as a template export', async () => {
        expect(await matchAdapter(
            'templates.create', 'spectora', intakeSourceFromText('contacts.csv', CONTACTS_CSV),
        )).toBeNull();
    });

    it('does not match a template export declared as a spreadsheet', async () => {
        // A container declared as a text file is refused before any decode: a
        // UTF-8 decode of a container is not a failed parse, it is a destroyed
        // file, and offering its fragments as column headings is worse than
        // refusing it.
        expect(await matchAdapter('contacts.import', 'csv_generic', spectoraSource())).toBeNull();
    });

    it('does not read a json document as a spreadsheet', async () => {
        // A line splitter finds "columns" in JSON because the separator it
        // looks for is a comma. Positive control below: the same commas in an
        // actual spreadsheet still match.
        const pretty = JSON.stringify({ id: 'x', rows: [{ a: 1 }, { b: 2 }] }, null, 2);
        expect(await matchAdapter(
            'contacts.import', 'csv_generic', intakeSourceFromText('export.json', pretty),
        )).toBeNull();
        expect((await matchAdapter(
            'members.invite', 'csv_generic', intakeSourceFromText('x.csv', 'Email\nzoe@example.test'),
        ))?.vendor).toBe('csv_generic');
    });

    it('never matches anything for the "I do not know what this is" entry', async () => {
        expect(await matchAdapter(
            'assisted.full', 'spectora', intakeSourceFromText('contacts.csv', CONTACTS_CSV),
        )).toBeNull();
        expect(await matchAdapter('assisted.full', 'spectora', spectoraSource())).toBeNull();
    });

    it('does not match an empty file', async () => {
        expect(await matchAdapter(
            'contacts.import', 'csv_generic', intakeSourceFromText('empty.csv', ''),
        )).toBeNull();
    });

    it('does not match a container that is not this vendor\'s export', async () => {
        const other = intakeSourceFromBytes('other.zip', await zipOf({ 'a.txt': 'hello' }));
        expect(await matchAdapter('templates.create', 'spectora', other)).toBeNull();
    });
});

describe('defaultMappingFor', () => {
    it('guesses contact columns from the header and says which it guessed', async () => {
        const source = intakeSourceFromText('contacts.csv', CONTACTS_CSV);
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        const mapping = defaultMappingFor('contacts.import', match!.inspection, source);
        expect(mapping.kind).toBe('contacts');
        if (mapping.kind !== 'contacts') return;
        expect(mapping.mapping.name).toBe('Full Name');
        expect(mapping.mapping.email).toBe('Email');
        expect(mapping.mapping.agency).toBe('Brokerage');
    });

    it('leaves the name column EMPTY when no header looks like a name', async () => {
        // The path this replaces fell back to the first column, which silently
        // imported an email address as everybody's name. An unanswered mapping
        // has to be visibly unanswered so the step can insist on an answer.
        const source = intakeSourceFromText('x.csv', 'Alpha,Beta\n1,2');
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        const mapping = defaultMappingFor('contacts.import', match!.inspection, source);
        expect(mapping.kind === 'contacts' && mapping.mapping.name).toBe('');
    });

    it('defaults the contact type to a fixed answer rather than leaving it open', async () => {
        const source = intakeSourceFromText('contacts.csv', CONTACTS_CSV);
        const match = await matchAdapter('contacts.import', 'csv_generic', source);
        const mapping = defaultMappingFor('contacts.import', match!.inspection, source);
        expect(mapping.kind === 'contacts' && mapping.mapping.type).toEqual({ fixed: 'client' });
    });

    it('names a template from the file, stripped of its extension', () => {
        // This export carries no name of its own, so the filename is all there
        // is — and it is the fallback rather than the answer.
        const mapping = defaultMappingFor(
            'templates.create', null, spectoraSource('Residential Export.xlsx'),
        );
        expect(mapping).toEqual({ kind: 'template', name: 'Residential Export' });
    });

    it('maps a staff list to an email column and a role everyone shares', async () => {
        const source = intakeSourceFromText('staff.csv', 'Email,Name\nzoe@example.test,Zoe');
        const match = await matchAdapter('members.invite', 'csv_generic', source);
        const mapping = defaultMappingFor('members.invite', match!.inspection, source);
        expect(mapping).toEqual({
            kind: 'members',
            mapping: { email: 'Email', role: { fixed: 'inspector' }, name: 'Name' },
        });
    });
});

describe('buildBundle', () => {
    it('produces a validating bundle from a spreadsheet and its mapping', async () => {
        const mapping: IntakeMapping = {
            kind: 'contacts',
            mapping: { name: 'Full Name', email: 'Email', agency: 'Brokerage', type: { fixed: 'agent' } },
        };
        const result = await buildBundle(
            'csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV), mapping,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.contacts).toHaveLength(2);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('produces a validating bundle from a vendor export and a name', async () => {
        const result = await buildBundle('spectora', spectoraSource(), {
            kind: 'template', name: 'Imported residential',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.templates[0]!.name).toBe('Imported residential');
    });

    it('reports an unreadable file as a value rather than throwing', async () => {
        const result = await buildBundle(
            'spectora', intakeSourceFromText('export.xlsx', 'not a workbook'),
            { kind: 'template', name: 'X' },
        );
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses a mapping that does not belong to the vendor', async () => {
        const result = await buildBundle('spectora', spectoraSource(), {
            kind: 'contacts',
            mapping: { name: 'Full Name', type: { fixed: 'client' } },
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MAPPING_MISMATCH');
    });

    it('refuses a template name handed to the spreadsheet adapter', async () => {
        const result = await buildBundle(
            'csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV),
            { kind: 'template', name: 'X' },
        );
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MAPPING_MISMATCH');
    });

    it('says which vendor has no adapter rather than guessing one', async () => {
        // `VendorId` names every vendor the stored format can record, including
        // files somebody converted offline. Only some of them have an adapter
        // here, and a batch recorded under one of the others cannot be rebuilt.
        const result = await buildBundle(
            'homegauge', intakeSourceFromText('x.csv', CONTACTS_CSV),
            { kind: 'contacts', mapping: { name: 'Full Name', type: { fixed: 'client' } } },
        );
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NO_ADAPTER');
        expect(!result.ok && result.error.message).toContain('homegauge');
    });
});
