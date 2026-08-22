/**
 * The Spectora adapter reads the file the export button produces.
 *
 * It did not. Its docblock described a four-bucket comment model mapped onto
 * three tabs, over a JSON object with a `sections` array. The export button
 * produces a SPREADSHEET, one row per canned comment, and marks each comment
 * info / limit / defect — which ARE our three tabs. So the adapter was written
 * against a different representation, and the mapping it made complicated is
 * the identity.
 */
import { describe, it, expect } from 'vitest';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { zipOf } from '../helpers/zip-fixture';

/**
 * The columns this reader needs, in the order the export carries them.
 *
 * The real export is 42 columns wide; the rest are photo slots, ordering,
 * answer types and timestamps that a template import does not consume.
 */
const HEADER = [
    'Section Name', 'Item Name', 'Comment Name', 'Comment Text',
    'Comment Type (info, limit, defect)',
];

function sheetXml(rows: string[][]): string {
    const cell = (v: string, col: number, row: number) =>
        `<c r="${String.fromCharCode(65 + col)}${row}" t="str"><v>${v.replace(/&/g, '&amp;')}</v></c>`;
    const body = rows.map((r, i) =>
        `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join('')}</row>`).join('');
    return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

const workbook = (rows: string[][]): Promise<Uint8Array> =>
    zipOf({ 'xl/worksheets/sheet1.xml': sheetXml(rows) });

const THREE_ROWS = [
    HEADER,
    ['Roof', 'Covering', 'Worn', 'The covering is worn.', 'defect'],
    ['Roof', 'Flashing', 'OK', 'Flashing appears serviceable.', 'info'],
    ['Exterior', 'Siding', 'Limited', 'Access was limited.', 'limit'],
];

describe('spectoraAdapter.inspect — the real export', () => {
    it('reports sections, items and the identity vocabulary', async () => {
        const got = await spectoraAdapter.inspect?.(await workbook(THREE_ROWS));
        expect(got?.kind).toBe('template');
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(2);
        expect(got.items).toBe(3);
        expect(got.ratings).toEqual(['info', 'limit', 'defect']);
    });

    it('reports no template name, because this export carries none', async () => {
        // Null rather than a filename or a placeholder: the caller already has
        // the filename, and a placeholder is indistinguishable from a template
        // genuinely called that.
        const got = await spectoraAdapter.inspect?.(await workbook(THREE_ROWS));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.name).toBeNull();
        expect(got.ratingsShown).toBeNull();
    });

    it('counts an item once however many comments it carries', async () => {
        const got = await spectoraAdapter.inspect?.(await workbook([
            HEADER,
            ['Roof', 'Covering', 'A', 'text', 'info'],
            ['Roof', 'Covering', 'B', 'text', 'defect'],
        ]));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(1);
        expect(got.items).toBe(1);
    });

    it('returns null for a workbook without the expected header', async () => {
        expect(await spectoraAdapter.inspect?.(await workbook([
            ['Name', 'Email'], ['Alice', 'a@b.test'],
        ]))).toBeNull();
    });

    it('returns null for bytes that are not a workbook at all', async () => {
        expect(await spectoraAdapter.inspect?.(
            new TextEncoder().encode('Full Name,Email\nAlice,a@b.test'),
        )).toBeNull();
    });
});

describe('spectoraAdapter.convert — the real export', () => {
    it('puts each comment on the tab its type names', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        const [template] = result.bundle.templates;
        const roof = template!.schema.sections.find((s) => s.title === 'Roof');
        const covering = roof?.items.find((i) => i.label === 'Covering');
        const flashing = roof?.items.find((i) => i.label === 'Flashing');
        expect(covering?.tabs?.defects.map((d) => d.title)).toEqual(['Worn']);
        expect(flashing?.tabs?.information.map((c) => c.title)).toEqual(['OK']);
        const siding = template!.schema.sections
            .find((s) => s.title === 'Exterior')?.items[0];
        expect(siding?.tabs?.limitations.map((c) => c.title)).toEqual(['Limited']);
    });

    it('keeps the file\'s own order for sections and items', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        const schema = result.bundle.templates[0]!.schema;
        expect(schema.sections.map((s) => s.title)).toEqual(['Roof', 'Exterior']);
        expect(schema.sections[0]!.items.map((i) => i.label)).toEqual(['Covering', 'Flashing']);
    });

    it('an EMPTY comment type is NAMED, not dropped', async () => {
        // Sixty-five of the real file's 1872 comments have no type. Dropping
        // them is how a count says 1872 and a template holds 1807, with nothing
        // saying which went.
        const result = await spectoraAdapter.convert(await workbook([
            HEADER,
            ['Roof', 'Covering', 'Worn', 'Text.', 'defect'],
            ['Roof', 'Covering', 'Untyped', 'Text.', ''],
        ]), { name: 'T' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(JSON.stringify(result.bundle)).toMatch(/Untyped/);
        expect(result.bundle.manifest.warnings.map((w) => w.message).join(' ')).toMatch(/Untyped/);
    });

    it('an UNRECOGNISED comment type is named too, and says what it said', async () => {
        const result = await spectoraAdapter.convert(await workbook([
            HEADER,
            ['Roof', 'Covering', 'Odd', 'Text.', 'maybe'],
        ]), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        const warnings = result.bundle.manifest.warnings.map((w) => w.message).join(' ');
        expect(warnings).toMatch(/Odd/);
        expect(warnings).toMatch(/maybe/);
    });

    it('POSITIVE CONTROL — a fully typed file raises no warning', async () => {
        // Without this, the two assertions above pass identically for an
        // adapter that warns about every row.
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        expect(result.bundle.manifest.warnings).toEqual([]);
    });

    it('the accounting balances — nothing can be silently skipped', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        const counts = result.bundle.manifest.counts.template;
        expect(counts.readFromSource).toBe(counts.emitted + counts.dropped.length);
    });

    it('takes the template name from the caller, never from the file', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'Chosen' });
        if (!result.ok) throw new Error('unreachable');
        expect(result.bundle.templates[0]!.name).toBe('Chosen');
    });

    it('refuses a workbook whose header is not this export\'s', async () => {
        const result = await spectoraAdapter.convert(await workbook([
            ['Name', 'Email'], ['Alice', 'a@b.test'],
        ]), { name: 'T' });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses an export with a header and no comment rows', async () => {
        // Distinct from the above and it has its own sentence: the operator
        // exported the right thing from the wrong place.
        const result = await spectoraAdapter.convert(await workbook([HEADER]), { name: 'T' });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('NO_SECTIONS');
    });
});
