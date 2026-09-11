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

    /**
     * The script-written workbook, which is a different file from the vendor
     * export the cases above are measured against. Its shape is taken from a
     * real upload: openpyxl, `t="inlineStr"` on every string, and not one `<v>`
     * in the whole sheet. The failure it used to produce is the reason these are
     * separate cases rather than one — a grid of the right SIZE full of empty
     * strings passes every structural check a caller can make.
     */
    describe('inline strings (`t="inlineStr"`, no `<v>` anywhere)', () => {
        const INLINE = `<?xml version="1.0"?>
<worksheet><sheetData>
<row r="1"><c r="A1" s="4" t="inlineStr"><is><t>ROOF</t></is></c></row>
<row r="2"><c r="A2" s="5" t="inlineStr"><is><t>Roof covering: Materials, condition and visible defects</t></is></c><c r="B2" s="6" t="n"></c></row>
<row r="3"><c r="A3" s="7" t="inlineStr"><is><t>Inspected</t></is></c><c r="B3" s="7" t="inlineStr"><is><t>Monitor</t></is></c></row>
</sheetData></worksheet>`;

        it('reads the text instead of returning blanks', async () => {
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': INLINE });
            const rows = await readXlsxSheet(bytes);
            expect(rows).not.toBeNull();
            expect(rows![0][0]).toBe('ROOF');
            expect(rows![1][0]).toBe('Roof covering: Materials, condition and visible defects');
            expect(rows![2]).toEqual(['Inspected', 'Monitor']);
        });

        it('NEGATIVE CONTROL — a blank read would have the same row count', async () => {
            // Why the case above asserts CONTENT and not shape. Before inline
            // strings were read, this file produced three rows of empty strings:
            // `rows.length` was right, the zero-rows guard never fired, and the
            // only visible symptom was a run reporting nothing to import.
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': INLINE });
            const rows = await readXlsxSheet(bytes);
            expect(rows!.length, 'the shape a blank read also satisfies').toBe(3);
            expect(rows!.flat().some((cell) => cell !== ''), 'something was actually read').toBe(true);
        });

        it('joins rich-text runs into one value', async () => {
            // One string split across runs. Taking the first `<t>` alone
            // truncates it, and a truncated section name is harder to notice
            // than an empty one.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><r><t>Attic / </t></r><r><t>Insulation</t></r></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('Attic / Insulation');
        });

        it('reads a `<t>` that carries xml:space="preserve"', async () => {
            // The attribute is how a writer keeps significant whitespace, so it
            // appears on exactly the values where dropping the cell would
            // change the text.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">  Gutters </t></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('  Gutters ');
        });

        it('decodes entities in an inline string the same way as a `<v>` one', async () => {
            // The decode is shared deliberately: an inline string that took a
            // different path would print `&amp;` where the other prints `&`.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Doors &amp;amp; Windows</t></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('Doors & Windows');
        });

        it('decodes the numeric references a script-written file is full of', async () => {
            // `&#9744;` is a ballot box and `&#8212;` an em dash; a real form used
            // both, one per rating column and one per item label. Undecoded they
            // import as literal `&#8212;`, which reads as a typo in somebody
            // else's template rather than as a decoding bug.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>HEIDEN &#8212; FIELD FORM</t></is></c><c r="B1" t="inlineStr"><is><t>&#9744; Inspected</t></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0]).toEqual(['HEIDEN — FIELD FORM', '☐ Inspected']);
        });

        it('decodes the HEX spelling of the same reference', async () => {
            // `&#x2014;` is the same em dash. A rule that handled only decimal
            // would be right on one writer's output and wrong on the next.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>A &#x2014; B</t></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('A — B');
        });

        it('decodes a DOUBLE-escaped numeric reference, like the named ones', async () => {
            // The two-pass bound has to know a numeric reference is an entity or
            // it stops after the first pass and leaves `&#8212;` in the text.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>A &amp;#8212; B</t></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('A — B');
        });

        it('leaves a reference that is not a character alone instead of throwing', async () => {
            // `fromCodePoint` throws above U+10FFFF, and a lone surrogate is
            // representable but is not a character. One malformed cell must not
            // fail the other forty thousand; the reference stays visible so the
            // operator can see what their file actually says.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>over &#1114112; and lone &#55296;</t></is></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('over &#1114112; and lone &#55296;');
        });

        it('still prefers `<v>` when a cell has one', async () => {
            // The ordinary case must not change. `<v>` is what every shared
            // string and every number resolves to.
            const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="str"><v>from v</v></c></row>
</sheetData></worksheet>`;
            const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': sheet });
            const rows = await readXlsxSheet(bytes);
            expect(rows![0][0]).toBe('from v');
        });
    });
});
