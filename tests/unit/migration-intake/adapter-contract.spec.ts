/**
 * What an adapter can report about a file it has not converted yet.
 *
 * Two shapes, because the wizard asks two different questions. A tabular source
 * is asked "which column holds the name". A template is asked something else
 * entirely — real vendor templates carry rating vocabularies with no shared
 * cardinality and no shared words, so no function can map them onto our three
 * comment tabs. The operator decides, and this is the shape that lets the
 * wizard ask.
 */
import { describe, it, expect } from 'vitest';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import {
    describeVendorMismatch,
    intakeSourceFromBytes,
    intakeSourceFromText,
    matchAdapter,
} from '../../../server/lib/migration-intake/adapters/registry';
import { zipOf } from '../helpers/zip-fixture';

const CONTACTS_CSV = 'Full Name,Email\nAlice Ng,alice@example.test\n';

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

/** The shape the export button actually produces: one row per canned comment. */
const spectoraExport = (): Promise<Uint8Array> => zipOf({
    'xl/worksheets/sheet1.xml': sheetXml([
        HEADER,
        ['Roof', 'Covering', 'Worn', 'The covering is worn.', 'defect'],
        ['Roof', 'Flashing', 'OK', 'Flashing appears serviceable.', 'info'],
        ['Exterior', 'Siding', 'Limited', 'Access was limited.', 'limit'],
    ]),
});

describe('AdapterInspection', () => {
    it('a tabular adapter reports the columns arm', async () => {
        const got = await csvGenericAdapter.inspect?.(CONTACTS_CSV);
        expect(got).not.toBeNull();
        expect(got?.kind).toBe('columns');
        if (got?.kind !== 'columns') throw new Error('unreachable');
        expect(got.columns).toEqual(['Full Name', 'Email']);
        expect(got.sampleRows.length).toBeGreaterThan(0);
    });

    it('still returns null for a file it cannot read at all', async () => {
        // The positive control for the above: `kind` must not be the only thing
        // that changed. An unreadable file is still null, not an empty columns
        // arm — the wizard reads null as "no question to ask" and an empty arm
        // as "a question with no answers", which are different screens.
        expect(await csvGenericAdapter.inspect?.('')).toBeNull();
    });
});

describe('spectoraAdapter.inspect', () => {
    it('reports the template arm with its counts', async () => {
        const got = await spectoraAdapter.inspect?.(await spectoraExport());
        expect(got?.kind).toBe('template');
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(2);
        expect(got.items).toBe(3);
    });

    it('reports the identity vocabulary, because that is what this format has', async () => {
        // This format marks each comment info / limit / defect, which are
        // already our three tabs. The vocabulary is reported so the wizard can
        // offer the identity mapping as the default rather than asking the
        // operator to invent it.
        const got = await spectoraAdapter.inspect?.(await spectoraExport());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratings).toEqual(['info', 'limit', 'defect']);
        // Absent is not false. The format has no such property, and saying
        // false would assert something it did not say.
        expect(got.ratingsShown).toBeNull();
    });

    it('reports no name of its own, because this export carries none', async () => {
        // Null rather than a filename or a placeholder: the caller has the
        // filename already, and a placeholder would be indistinguishable from
        // a template genuinely called that.
        const got = await spectoraAdapter.inspect?.(await spectoraExport());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.name).toBeNull();
    });

    it('returns null for something that is not this export', async () => {
        // Positive control: `inspect` returning a template arm for anything at
        // all would make every file look like a template export.
        expect(await spectoraAdapter.inspect?.('Full Name,Email\nAlice,a@b.test')).toBeNull();
        expect(await spectoraAdapter.inspect?.(new TextEncoder().encode('{"hello":1}'))).toBeNull();
        expect(await spectoraAdapter.inspect?.(await zipOf({ 'a.txt': 'hello' }))).toBeNull();
    });
});

describe('the operator declares the vendor', () => {
    it('matches when the declared vendor reads the file', async () => {
        const src = intakeSourceFromBytes('export.xlsx', await spectoraExport());
        expect((await matchAdapter('templates.create', 'spectora', src))?.vendor).toBe('spectora');
    });

    it('does not match when the file is not what was declared', async () => {
        const src = intakeSourceFromText('people.csv', 'Full Name,Email\nA,a@b.test');
        expect(await matchAdapter('templates.create', 'spectora', src)).toBeNull();
    });

    it('says what it looks like instead — this is the whole point of the change', async () => {
        // Before this, the intent chose the vendor, so the only answer
        // available was "no adapter". The operator's declaration is what makes
        // a specific sentence possible.
        const src = intakeSourceFromText('people.csv', 'Full Name,Email\nA,a@b.test');
        const mismatch = await describeVendorMismatch('templates.create', 'spectora', src);
        expect(mismatch).not.toBeNull();
        expect(mismatch?.declared).toBe('spectora');
        expect(mismatch?.looksLike).toBe('csv_generic');
    });

    it('reports no mismatch when the declaration is right — the positive control', async () => {
        const src = intakeSourceFromBytes('export.xlsx', await spectoraExport());
        expect(await describeVendorMismatch('templates.create', 'spectora', src)).toBeNull();
    });

    it('distinguishes "looks like another vendor" from "nothing here reads it"', async () => {
        // Two different next steps. A file that looks like a vendor we read
        // offers a correction; one nothing recognises offers the assisted path,
        // and conflating them sends people down the wrong one. A zip that is
        // not a template export is refused by the container adapters, and the
        // tabular adapter refuses every container outright.
        const unreadable = intakeSourceFromBytes('other.zip', await zipOf({ 'a.txt': 'hello' }));
        const mismatch = await describeVendorMismatch('templates.create', 'spectora', unreadable);
        expect(mismatch?.declared).toBe('spectora');
        expect(mismatch?.looksLike).toBeNull();
    });

    it('a vendor with no adapter yet is a null match, not a crash', async () => {
        // homegauge is a known vendor with no adapter here. The wizard routes
        // those to the assisted path, so this must be an ordinary null rather
        // than an exception.
        const src = intakeSourceFromText('form.HGF', '<xml/>');
        expect(await matchAdapter('templates.create', 'homegauge', src)).toBeNull();
    });

    it('assisted.full never matches, whatever vendor is declared', async () => {
        const src = intakeSourceFromBytes('export.xlsx', await spectoraExport());
        expect(await matchAdapter('assisted.full', 'spectora', src)).toBeNull();
    });
});
