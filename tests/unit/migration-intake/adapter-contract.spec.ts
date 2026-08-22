/**
 * What an adapter can report about a file it has not converted yet.
 *
 * Two shapes, because the wizard asks two different questions. A tabular source
 * is asked "which column holds the name". A template is asked something else
 * entirely — real vendor templates carry rating vocabularies with no shared
 * cardinality and no shared words, so no function can map them onto our three
 * comment tabs. The operator decides, and this is the shape that lets the wizard
 * ask.
 */
import { describe, it, expect } from 'vitest';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import {
    describeVendorMismatch,
    intakeSourceFromText,
    matchAdapter,
} from '../../../server/lib/migration-intake/adapters/registry';

const CONTACTS_CSV = 'Full Name,Email\nAlice Ng,alice@example.test\n';

/** The shape this adapter reads today. Not the real export — see below. */
const SPECTORA_JSON = JSON.stringify({
    name: 'Commercial Inspection',
    sections: [
        { name: 'Roof', items: [{ name: 'Covering' }, { name: 'Flashing' }] },
        { name: 'Exterior', items: [{ name: 'Siding' }] },
    ],
});

describe('AdapterInspection', () => {
    it('a tabular adapter reports the columns arm', () => {
        const got = csvGenericAdapter.inspect?.(CONTACTS_CSV);
        expect(got).not.toBeNull();
        expect(got?.kind).toBe('columns');
        if (got?.kind !== 'columns') throw new Error('unreachable');
        expect(got.columns).toEqual(['Full Name', 'Email']);
        expect(got.sampleRows.length).toBeGreaterThan(0);
    });

    it('still returns null for a file it cannot read at all', () => {
        // The positive control for the above: `kind` must not be the only thing
        // that changed. An unreadable file is still null, not an empty columns
        // arm — the wizard reads null as "no question to ask" and an empty arm
        // as "a question with no answers", which are different screens.
        expect(csvGenericAdapter.inspect?.('')).toBeNull();
    });
});

/**
 * ⚠️ This inspects the shape the Spectora adapter reads TODAY — a JSON object
 * with a `sections` array. It is NOT the real export, which is a spreadsheet;
 * teaching it that is a later milestone. This exists so the wizard has a
 * template arm to render before any new format lands.
 */
describe('spectoraAdapter.inspect', () => {
    it('reports the template arm with its own name and its counts', () => {
        const got = spectoraAdapter.inspect?.(SPECTORA_JSON);
        expect(got?.kind).toBe('template');
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.name).toBe('Commercial Inspection');
        expect(got.sections).toBe(2);
        expect(got.items).toBe(3);
    });

    it('reports the identity vocabulary, because that is what this format has', () => {
        // This format marks each comment info / limit / defect, which are
        // already our three tabs. The vocabulary is reported so the wizard can
        // offer the identity mapping as the default rather than asking the
        // operator to invent it.
        const got = spectoraAdapter.inspect?.(SPECTORA_JSON);
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratings).toEqual(['info', 'limit', 'defect']);
        // Absent is not false. The format has no such property, and saying
        // false would assert something it did not say.
        expect(got.ratingsShown).toBeNull();
    });

    it('reports no name of its own when the export does not carry one', () => {
        // Null rather than a filename or a placeholder: the caller has the
        // filename already, and a placeholder would be indistinguishable from
        // a template genuinely called that.
        const got = spectoraAdapter.inspect?.(JSON.stringify({ sections: [] }));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.name).toBeNull();
        expect(got.sections).toBe(0);
        expect(got.items).toBe(0);
    });

    it('returns null for something that is not a Spectora export', () => {
        // Positive control: `inspect` returning a template arm for anything at
        // all would make every file look like a Spectora template.
        expect(spectoraAdapter.inspect?.('Full Name,Email\nAlice,a@b.test')).toBeNull();
        expect(spectoraAdapter.inspect?.('{"hello":1}')).toBeNull();
        expect(spectoraAdapter.inspect?.('[]')).toBeNull();
    });
});

describe('the operator declares the vendor', () => {
    it('matches when the declared vendor reads the file', () => {
        const src = intakeSourceFromText('export.json', SPECTORA_JSON);
        expect(matchAdapter('templates.create', 'spectora', src)?.vendor).toBe('spectora');
    });

    it('does not match when the file is not what was declared', () => {
        const src = intakeSourceFromText('people.csv', 'Full Name,Email\nA,a@b.test');
        expect(matchAdapter('templates.create', 'spectora', src)).toBeNull();
    });

    it('says what it looks like instead — this is the whole point of the change', () => {
        // Before this, the intent chose the vendor, so the only answer available
        // was "no adapter". The operator's declaration is what makes a specific
        // sentence possible.
        const src = intakeSourceFromText('people.csv', 'Full Name,Email\nA,a@b.test');
        const mismatch = describeVendorMismatch('templates.create', 'spectora', src);
        expect(mismatch).not.toBeNull();
        expect(mismatch?.declared).toBe('spectora');
        expect(mismatch?.looksLike).toBe('csv_generic');
    });

    it('reports no mismatch when the declaration is right — the positive control', () => {
        const src = intakeSourceFromText('export.json', SPECTORA_JSON);
        expect(describeVendorMismatch('templates.create', 'spectora', src)).toBeNull();
    });

    it('distinguishes "looks like another vendor" from "nothing here reads it"', () => {
        // Two different next steps. A file that looks like a vendor we read
        // offers a correction; one nothing recognises offers the assisted path,
        // and conflating them sends people down the wrong one.
        // JSON that is not a template export: the template adapter refuses it
        // for having no sections, and the spreadsheet adapter refuses every
        // JSON document outright.
        const unreadable = intakeSourceFromText('other.json', '{"hello":1}');
        const mismatch = describeVendorMismatch('templates.create', 'spectora', unreadable);
        expect(mismatch?.declared).toBe('spectora');
        expect(mismatch?.looksLike).toBeNull();
    });

    it('a vendor with no adapter yet is a null match, not a crash', () => {
        // homegauge is a known vendor with no adapter here. The wizard routes
        // those to the assisted path, so this must be an ordinary null rather
        // than an exception.
        const src = intakeSourceFromText('form.HGF', '<xml/>');
        expect(matchAdapter('templates.create', 'homegauge', src)).toBeNull();
    });

    it('assisted.full never matches, whatever vendor is declared', () => {
        const src = intakeSourceFromText('export.json', SPECTORA_JSON);
        expect(matchAdapter('assisted.full', 'spectora', src)).toBeNull();
    });
});
