/**
 * Bytes to rows, for the one shape a vendor export actually has.
 *
 * Measured against a real spreadsheet export rather than a generated workbook,
 * because two of its properties would not appear in one: its shared-string
 * table is empty (every value inline), and its ampersands are escaped twice. A
 * reader written the usual way returns an empty sheet for the first, and prints
 * an entity where a section name should be for the second.
 */
import { describe, it, expect } from 'vitest';
import { readXlsxSheet } from '../../../server/lib/migration-intake/formats/xlsx-sheet';
import { zipOf } from '../helpers/zip-fixture';

const SHEET = `<?xml version="1.0"?>
<worksheet><sheetData>
<row r="1"><c r="A1" t="str"><v>Section Name</v></c><c r="B1" t="str"><v>Item Name</v></c></row>
<row r="2"><c r="A2" t="str"><v>Decks, Balconies, Porches &amp;amp; Steps</v></c><c r="B2" t="str"><v>Covering</v></c></row>
<row r="3"><c r="A3" t="str"><v>Roof</v></c></row>
</sheetData></worksheet>`;

describe('readXlsxSheet', () => {
    it('reads inline values with an EMPTY shared-string table', async () => {
        const bytes = await zipOf({
            'xl/worksheets/sheet1.xml': SHEET,
            'xl/sharedStrings.xml': '<?xml version="1.0"?><sst count="0" uniqueCount="0"/>',
        });
        const rows = await readXlsxSheet(bytes);
        expect(rows).not.toBeNull();
        expect(rows![0]).toEqual(['Section Name', 'Item Name']);
    });

    it('decodes a DOUBLE-escaped ampersand to one character', async () => {
        // The real file holds `&amp;amp;`. A single XML decode leaves `&amp;`,
        // which is what would print in a report. This is the assertion a
        // hand-made fixture would never have produced.
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': SHEET });
        const rows = await readXlsxSheet(bytes);
        expect(rows![1][0]).toBe('Decks, Balconies, Porches & Steps');
    });

    it('decodes a SINGLE-escaped ampersand to the same one character', async () => {
        const single = SHEET.replace('&amp;amp;', '&amp;');
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': single });
        const rows = await readXlsxSheet(bytes);
        expect(rows![1][0]).toBe('Decks, Balconies, Porches & Steps');
    });

    it('POSITIVE CONTROL — decoding STOPS after two passes', async () => {
        // The bound on the rule above. Decoding to a fixed point would take a
        // section legitimately holding the TEXT `&amp;` down to `&`, and there
        // would be nothing to stop it. Two passes is the observed depth: the
        // vendor escapes its own content once and the XML writer escapes that.
        const triple = SHEET.replace('&amp;amp;', '&amp;amp;amp;');
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': triple });
        const rows = await readXlsxSheet(bytes);
        expect(rows![1][0]).toBe('Decks, Balconies, Porches &amp; Steps');
    });

    it('does not let the ampersand rule eat a neighbouring entity', async () => {
        // Within one pass `&amp;` must be decoded LAST, or `&amp;lt;` becomes
        // `&lt;` and then `<` in the same pass — two decodes' worth of work in
        // one, and the bound above stops meaning anything.
        const sheet = SHEET.replace('<v>Roof</v>', '<v>A &amp;lt; B</v>');
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
        const rows = await readXlsxSheet(bytes);
        expect(rows![2][0]).toBe('A < B');
    });

    it('pads a short row so column indices stay aligned', async () => {
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': SHEET });
        const rows = await readXlsxSheet(bytes);
        expect(rows![2]).toEqual(['Roof', '']);
    });

    it('places a cell by its column LETTER, not by its position in the row', async () => {
        // A skipped column is written by omitting the cell entirely, so a
        // reader that pushes cells in order shifts every later value one to the
        // left — and "column 5 is the comment type" becomes true only sometimes.
        const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="str"><v>a</v></c><c r="C1" t="str"><v>c</v></c></row>
</sheetData></worksheet>`;
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
        const rows = await readXlsxSheet(bytes);
        expect(rows![0]).toEqual(['a', '', 'c']);
    });

    it('reads a column letter past Z', async () => {
        // The real export is 42 columns wide, so `AP` is an ordinary address
        // there and a base-26 mistake would silently misplace a third of it.
        const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="AA1" t="str"><v>z</v></c></row>
</sheetData></worksheet>`;
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
        const rows = await readXlsxSheet(bytes);
        expect(rows![0].length).toBe(27);
        expect(rows![0][26]).toBe('z');
    });

    it('returns null for bytes that are not a workbook', async () => {
        expect(await readXlsxSheet(new TextEncoder().encode('Name,Email\nA,b@c.test'))).toBeNull();
        expect(await readXlsxSheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    });

    it('returns null for a zip that is not a workbook', async () => {
        const bytes = await zipOf({ 'TabbedPanes.tpl': '<java/>' });
        expect(await readXlsxSheet(bytes)).toBeNull();
    });
});
