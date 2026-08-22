/**
 * The Spectora adapter — the bundle it produces, and the two shapes it refuses.
 *
 * The conversion itself is covered by `spectora-xlsx.spec.ts`; what is asserted
 * here is that the result is a BUNDLE whose accounting validates, which is the
 * property the staging step depends on and the one a conversion test would not
 * notice breaking.
 */
import { describe, it, expect } from 'vitest';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import { zipOf } from '../helpers/zip-fixture';

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

const EXPORT = () => workbook([
    HEADER,
    ['Roof', 'Covering', 'Missing shingles', 'Several are gone.', 'defect'],
    ['Roof', 'Covering', 'Material', 'Asphalt.', 'info'],
]);

describe('spectoraAdapter', () => {
    it('produces a bundle that passes the format validator', async () => {
        const result = await spectoraAdapter.convert(await EXPORT(), { name: 'Imported residential' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
        expect(parsed.ok).toBe(true);
    });

    it('names the template from the caller, not from the export', async () => {
        const result = await spectoraAdapter.convert(await EXPORT(), { name: 'Imported residential' });
        expect(result.ok && result.bundle.templates[0]!.name).toBe('Imported residential');
    });

    it('accounts for exactly one template read and one emitted', async () => {
        const result = await spectoraAdapter.convert(await EXPORT(), { name: 'X' });
        expect(result.ok && result.bundle.manifest.counts.template)
            .toEqual({ readFromSource: 1, emitted: 1, dropped: [] });
        expect(result.ok && result.bundle.manifest.counts.contact.emitted).toBe(0);
        expect(result.ok && result.bundle.manifest.counts.member.emitted).toBe(0);
    });

    it('carries no primary key of ours anywhere in the bundle', async () => {
        const result = await spectoraAdapter.convert(await EXPORT(), { name: 'X' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(Object.keys(result.bundle.templates[0]!)).toEqual(['name', 'schema', 'stats']);
    });

    it('is PURE — the same bytes convert to the same bundle', async () => {
        // Ids are derived from a row's position, never minted. Without that a
        // re-map could not be compared against what was staged, and two runs of
        // the same file would look like two different templates.
        const bytes = await EXPORT();
        const first = await spectoraAdapter.convert(bytes, { name: 'X' });
        const second = await spectoraAdapter.convert(bytes, { name: 'X' });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('refuses a payload that is not a workbook', async () => {
        const result = await spectoraAdapter.convert(
            new TextEncoder().encode('not a workbook'), { name: 'X' },
        );
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses an export with no comment rows rather than emitting an empty template', async () => {
        const result = await spectoraAdapter.convert(await workbook([HEADER]), { name: 'X' });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NO_SECTIONS');
    });
});
