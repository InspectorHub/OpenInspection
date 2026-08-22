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
import { describe, it, expect } from 'vitest';
import {
    ADAPTER_VENDORS,
    INTAKE_INTENTS,
    buildBundle,
    defaultMappingFor,
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
                const isTemplate = intent.startsWith('templates.');
                const source: IntakeSource = isTemplate
                    ? intakeSourceFromText('export.json', SPECTORA_JSON)
                    : intakeSourceFromText('people.csv', CONTACTS_CSV);
                const vendor: VendorId = isTemplate ? 'spectora' : 'csv_generic';
                return [intent, matchAdapter(intent, vendor, source)?.adapterName ?? null];
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
        const match: AdapterMatch | null = matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV));
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

    it('matches a vendor export for a template import and reports a TEMPLATE, not columns', () => {
        // This used to assert `inspection` was null, and read that as "a vendor
        // export has no columns, so the wizard has no question". That was true
        // about columns and false about the file: a template's question is what
        // its comment vocabulary means. The arm is what carries it.
        const match = matchAdapter('templates.create', 'spectora', intakeSourceFromText('export.json', SPECTORA_JSON));
        expect(match?.vendor).toBe('spectora');
        expect(match?.adapterName).toBe(spectoraAdapter.name);
        expect(match?.inspection?.kind).toBe('template');
        if (match?.inspection?.kind !== 'template') throw new Error('unreachable');
        expect(match.inspection.name).toBe('Residential');
        expect(match.inspection.sections).toBe(1);
        // Both adapters report; which ARM they report is what differs.
        expect(typeof spectoraAdapter.inspect).toBe('function');
        expect(typeof csvGenericAdapter.inspect).toBe('function');
    });

    // ⚠️ These two still pass and now mean something DIFFERENT. Before, the
    // intent picked the vendor and the file simply did not match it. Now the
    // operator's own declaration is what the file contradicts — which is what
    // makes a specific sentence possible. See `describeVendorMismatch` in
    // adapter-contract.spec.ts.
    it('does not match a spreadsheet declared as a template export', () => {
        expect(matchAdapter('templates.create', 'spectora', intakeSourceFromText('contacts.csv', CONTACTS_CSV))).toBeNull();
    });

    it('does not match a template export declared as a spreadsheet', () => {
        expect(matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('export.json', SPECTORA_JSON))).toBeNull();
    });

    it('does not read a pretty-printed json document as a spreadsheet', () => {
        // A line splitter finds "columns" in JSON because the separator it looks
        // for is a comma. Positive control below: the same commas in an actual
        // spreadsheet still match.
        const pretty = JSON.stringify(JSON.parse(SPECTORA_JSON), null, 2);
        expect(matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('export.json', pretty))).toBeNull();
        expect(matchAdapter('members.invite', 'csv_generic', intakeSourceFromText('x.csv', 'Email\nzoe@example.test'))?.vendor)
            .toBe('csv_generic');
    });

    it('never matches anything for the "I do not know what this is" entry', () => {
        expect(matchAdapter('assisted.full', 'spectora', intakeSourceFromText('contacts.csv', CONTACTS_CSV))).toBeNull();
        expect(matchAdapter('assisted.full', 'spectora', intakeSourceFromText('export.json', SPECTORA_JSON))).toBeNull();
    });

    it('does not match an empty file', () => {
        expect(matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('empty.csv', ''))).toBeNull();
    });

    it('does not match json that is not a template export', () => {
        expect(matchAdapter('templates.create', 'spectora', intakeSourceFromText('x.json', '{"hello":1}'))).toBeNull();
    });
});

describe('defaultMappingFor', () => {
    it('guesses contact columns from the header and says which it guessed', () => {
        const match = matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV));
        const mapping = defaultMappingFor('contacts.import', match!.inspection, intakeSourceFromText('contacts.csv', CONTACTS_CSV));
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
        const match = matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('x.csv', text));
        const mapping = defaultMappingFor('contacts.import', match!.inspection, intakeSourceFromText('x.csv', text));
        expect(mapping.kind === 'contacts' && mapping.mapping.name).toBe('');
    });

    it('defaults the contact type to a fixed answer rather than leaving it open', () => {
        const match = matchAdapter('contacts.import', 'csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV));
        const mapping = defaultMappingFor('contacts.import', match!.inspection, intakeSourceFromText('contacts.csv', CONTACTS_CSV));
        expect(mapping.kind === 'contacts' && mapping.mapping.type).toEqual({ fixed: 'client' });
    });

    it('names a template from the file, stripped of its extension', () => {
        const mapping = defaultMappingFor('templates.create', null, intakeSourceFromText('Residential Export.json', SPECTORA_JSON));
        expect(mapping).toEqual({ kind: 'template', name: 'Residential Export' });
    });

    it('maps a staff list to an email column and a role everyone shares', () => {
        const text = 'Email,Name\nzoe@example.test,Zoe';
        const match = matchAdapter('members.invite', 'csv_generic', intakeSourceFromText('staff.csv', text));
        const mapping = defaultMappingFor('members.invite', match!.inspection, intakeSourceFromText('staff.csv', text));
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
        const result = buildBundle('csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV), mapping);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.contacts).toHaveLength(2);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('produces a validating bundle from a vendor export and a name', () => {
        const result = buildBundle('spectora', intakeSourceFromText('export.json', SPECTORA_JSON), {
            kind: 'template', name: 'Imported residential',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.templates[0].name).toBe('Imported residential');
    });

    it('reports unreadable json as a value rather than throwing', () => {
        const result = buildBundle('spectora', intakeSourceFromText('export.json', 'not json'), {
            kind: 'template', name: 'X',
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses a mapping that does not belong to the vendor', () => {
        const result = buildBundle('spectora', intakeSourceFromText('export.json', SPECTORA_JSON), {
            kind: 'contacts',
            mapping: { name: 'Full Name', type: { fixed: 'client' } },
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MAPPING_MISMATCH');
    });

    it('refuses a template name handed to the spreadsheet adapter', () => {
        const result = buildBundle('csv_generic', intakeSourceFromText('contacts.csv', CONTACTS_CSV), {
            kind: 'template', name: 'X',
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MAPPING_MISMATCH');
    });

    it('says which vendor has no adapter rather than guessing one', () => {
        // `VendorId` names every vendor the stored format can record, including
        // files somebody converted offline. Only some of them have an adapter
        // here, and a batch recorded under one of the others cannot be rebuilt.
        const result = buildBundle('homegauge', intakeSourceFromText('x.csv', CONTACTS_CSV), {
            kind: 'contacts',
            mapping: { name: 'Full Name', type: { fixed: 'client' } },
        });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NO_ADAPTER');
        expect(!result.ok && result.error.message).toContain('homegauge');
    });
});
