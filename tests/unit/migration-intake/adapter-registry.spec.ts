/**
 * Which adapter reads this file, and what the wizard therefore has to ask.
 *
 * The mapping step is skipped when the matched adapter has no `inspect`. That
 * is a fact about the adapter's TYPE, not a branch in the interface: a vendor
 * export has no columns to point at, so there is no question to put on screen.
 *
 * The "I do not know what this is" entry never runs an adapter at all. It is
 * the entry point for a file nobody could classify, and having it guess would
 * be the same inference the whole design refuses everywhere else.
 */
import { describe, it, expect } from 'vitest';
import {
    ADAPTER_VENDORS,
    INTAKE_INTENTS,
    buildBundle,
    defaultMappingFor,
    matchAdapter,
    type AdapterMatch,
    type IntakeMapping,
    type IntakeSource,
} from '../../../server/lib/migration-intake/adapters/registry';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';

const CONTACTS_CSV = [
    'Full Name,Email,Brokerage',
    'Alice Ng,alice@example.test,Acme Realty',
    'Bob Ray,bob@example.test,"Beta, Inc."',
].join('\n');

const SPECTORA_JSON = JSON.stringify({
    id: 'sp-1',
    name: 'Residential',
    sections: [{
        id: 'sec-1',
        name: 'Roof',
        items: [{ id: 'it-1', name: 'Covering', comments: [{ id: 'c-1', type: 'DEFECT', title: 'Missing', text: 'x' }] }],
    }],
});

describe('the registry table', () => {
    it('registers each adapter under the vendor that adapter says it reads', () => {
        // Not a count. A table keyed by vendor is only a lookup if the key and
        // the thing found under it agree about who it is; a mismatch here would
        // route a rebuild to the wrong adapter and still pass a size check.
        expect(Object.entries(ADAPTER_VENDORS).map(([key, adapter]) => [key, adapter?.name ?? null]))
            .toEqual([['spectora', 'spectora'], ['csv_generic', 'csv-generic']]);
        for (const [vendor, adapter] of Object.entries(ADAPTER_VENDORS)) {
            expect(adapter?.vendor).toBe(vendor);
        }
    });

    it('positive control: every intent that names an entity family resolves to a registered adapter', () => {
        // An empty registry would satisfy every "unknown key finds nothing"
        // assertion in this file. This is the assertion it could not satisfy.
        const resolved = INTAKE_INTENTS
            .filter((intent) => intent !== 'assisted.full')
            .map((intent) => {
                const source: IntakeSource = intent.startsWith('templates.')
                    ? { fileName: 'export.json', text: SPECTORA_JSON }
                    : { fileName: 'people.csv', text: CONTACTS_CSV };
                return [intent, matchAdapter(intent, source)?.adapterName ?? null];
            });
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
    it('matches a spreadsheet for a contact import and reports its columns', () => {
        const match: AdapterMatch | null = matchAdapter('contacts.import', { fileName: 'contacts.csv', text: CONTACTS_CSV });
        expect(match?.vendor).toBe('csv_generic');
        expect(match?.adapterName).toBe(csvGenericAdapter.name);
        expect(match?.adapterVersion).toBe(csvGenericAdapter.version);
        expect(match?.inspection?.columns).toEqual(['Full Name', 'Email', 'Brokerage']);
        expect(match?.inspection?.sampleRows[0]).toEqual({
            'Full Name': 'Alice Ng', Email: 'alice@example.test', Brokerage: 'Acme Realty',
        });
    });

    it('matches a vendor export for a template import and reports NO columns', () => {
        const match = matchAdapter('templates.create', { fileName: 'export.json', text: SPECTORA_JSON });
        expect(match?.vendor).toBe('spectora');
        expect(match?.adapterName).toBe(spectoraAdapter.name);
        // The absence is the point: nothing to map, so nothing to ask.
        expect(match?.inspection).toBeNull();
        // And the absence is derived, not written down per vendor.
        expect(spectoraAdapter.inspect).toBeUndefined();
        expect(typeof csvGenericAdapter.inspect).toBe('function');
    });

    it('does not match a spreadsheet against a template import', () => {
        expect(matchAdapter('templates.create', { fileName: 'contacts.csv', text: CONTACTS_CSV })).toBeNull();
    });

    it('does not match a vendor export against a contact import', () => {
        expect(matchAdapter('contacts.import', { fileName: 'export.json', text: SPECTORA_JSON })).toBeNull();
    });

    it('does not read a pretty-printed json document as a spreadsheet', () => {
        // A line splitter finds "columns" in JSON because the separator it looks
        // for is a comma. Positive control below: the same commas in an actual
        // spreadsheet still match.
        const pretty = JSON.stringify(JSON.parse(SPECTORA_JSON), null, 2);
        expect(matchAdapter('contacts.import', { fileName: 'export.json', text: pretty })).toBeNull();
        expect(matchAdapter('members.invite', { fileName: 'x.csv', text: 'Email\nzoe@example.test' })?.vendor)
            .toBe('csv_generic');
    });

    it('never matches anything for the "I do not know what this is" entry', () => {
        expect(matchAdapter('assisted.full', { fileName: 'contacts.csv', text: CONTACTS_CSV })).toBeNull();
        expect(matchAdapter('assisted.full', { fileName: 'export.json', text: SPECTORA_JSON })).toBeNull();
    });

    it('does not match an empty file', () => {
        expect(matchAdapter('contacts.import', { fileName: 'empty.csv', text: '' })).toBeNull();
    });

    it('does not match json that is not a template export', () => {
        expect(matchAdapter('templates.create', { fileName: 'x.json', text: '{"hello":1}' })).toBeNull();
    });
});

describe('defaultMappingFor', () => {
    it('guesses contact columns from the header and says which it guessed', () => {
        const match = matchAdapter('contacts.import', { fileName: 'contacts.csv', text: CONTACTS_CSV });
        const mapping = defaultMappingFor('contacts.import', match!.inspection, {
            fileName: 'contacts.csv', text: CONTACTS_CSV,
        });
        expect(mapping.kind).toBe('contacts');
        if (mapping.kind !== 'contacts') return;
        expect(mapping.mapping.name).toBe('Full Name');
        expect(mapping.mapping.email).toBe('Email');
        expect(mapping.mapping.agency).toBe('Brokerage');
    });

    it('leaves the name column EMPTY when no header looks like a name', () => {
        // The path this replaces fell back to the first column, which silently
        // imported an email address as everybody's name. An unanswered mapping
        // has to be visibly unanswered so the step can insist on an answer.
        const text = 'Alpha,Beta\n1,2';
        const match = matchAdapter('contacts.import', { fileName: 'x.csv', text });
        const mapping = defaultMappingFor('contacts.import', match!.inspection, { fileName: 'x.csv', text });
        expect(mapping.kind === 'contacts' && mapping.mapping.name).toBe('');
    });

    it('defaults the contact type to a fixed answer rather than leaving it open', () => {
        const match = matchAdapter('contacts.import', { fileName: 'contacts.csv', text: CONTACTS_CSV });
        const mapping = defaultMappingFor('contacts.import', match!.inspection, {
            fileName: 'contacts.csv', text: CONTACTS_CSV,
        });
        expect(mapping.kind === 'contacts' && mapping.mapping.type).toEqual({ fixed: 'client' });
    });

    it('names a template from the file, stripped of its extension', () => {
        const mapping = defaultMappingFor('templates.create', null, {
            fileName: 'Residential Export.json', text: SPECTORA_JSON,
        });
        expect(mapping).toEqual({ kind: 'template', name: 'Residential Export' });
    });

    it('maps a staff list to an email column and a role everyone shares', () => {
        const text = 'Email,Name\nzoe@example.test,Zoe';
        const match = matchAdapter('members.invite', { fileName: 'staff.csv', text });
        const mapping = defaultMappingFor('members.invite', match!.inspection, { fileName: 'staff.csv', text });
        expect(mapping).toEqual({
            kind: 'members',
            mapping: { email: 'Email', role: { fixed: 'inspector' }, name: 'Name' },
        });
    });
});

describe('buildBundle', () => {
    it('produces a validating bundle from a spreadsheet and its mapping', () => {
        const mapping: IntakeMapping = {
            kind: 'contacts',
            mapping: { name: 'Full Name', email: 'Email', agency: 'Brokerage', type: { fixed: 'agent' } },
        };
        const result = buildBundle('csv_generic', { fileName: 'contacts.csv', text: CONTACTS_CSV }, mapping);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.contacts).toHaveLength(2);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('produces a validating bundle from a vendor export and a name', () => {
        const result = buildBundle('spectora', { fileName: 'export.json', text: SPECTORA_JSON }, {
            kind: 'template', name: 'Imported residential',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.templates[0].name).toBe('Imported residential');
    });

    it('reports unreadable json as a value rather than throwing', () => {
        const result = buildBundle('spectora', { fileName: 'export.json', text: 'not json' }, {
            kind: 'template', name: 'X',
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses a mapping that does not belong to the vendor', () => {
        const result = buildBundle('spectora', { fileName: 'export.json', text: SPECTORA_JSON }, {
            kind: 'contacts',
            mapping: { name: 'Full Name', type: { fixed: 'client' } },
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MAPPING_MISMATCH');
    });

    it('refuses a template name handed to the spreadsheet adapter', () => {
        const result = buildBundle('csv_generic', { fileName: 'contacts.csv', text: CONTACTS_CSV }, {
            kind: 'template', name: 'X',
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MAPPING_MISMATCH');
    });

    it('says which vendor has no adapter rather than guessing one', () => {
        // `VendorId` names every vendor the stored format can record, including
        // files somebody converted offline. Only some of them have an adapter
        // here, and a batch recorded under one of the others cannot be rebuilt.
        const result = buildBundle('homegauge', { fileName: 'x.csv', text: CONTACTS_CSV }, {
            kind: 'contacts',
            mapping: { name: 'Full Name', type: { fixed: 'client' } },
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NO_ADAPTER');
        expect(!result.ok && result.error.message).toContain('homegauge');
    });
});
