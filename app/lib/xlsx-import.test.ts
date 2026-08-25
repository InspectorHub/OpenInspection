/**
 * .xlsx import — pure conversion layer (app/lib/xlsx-import.ts).
 *
 * The upload form parses the workbook CLIENT-side (vendored exceljs browser
 * build, script-injected on demand), asks which sheet holds the list, and puts
 * that one sheet's CSV into the same file input — so the server, the mapping
 * step and the preview step read exactly what they read today. These tests
 * drive the conversion against REAL ExcelJS workbook objects (the node build of
 * the same library); the browser loader only differs in how the library
 * arrives.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { cellToText, rowsToCsv, sheetChoices, workbookSheetToCsv } from '~/lib/xlsx-import';

type Book = Parameters<typeof workbookSheetToCsv>[0];

/** Cover / (blank) / Contacts — the shape the picker exists for. The blank
 *  sheet in the middle is what makes "workbook-order indices" testable at all:
 *  drop it and `Contacts` is still `worksheets[2]`. */
function threeSheetWorkbook(): Book {
    const wb = new ExcelJS.Workbook();
    const cover = wb.addWorksheet('Cover');
    cover.addRow(['Exported by', 'Acme, Inc.']);
    wb.addWorksheet('Blank');
    const contacts = wb.addWorksheet('Contacts');
    contacts.addRow(['name', 'email']);
    contacts.addRow(['Alice Example', 'alice@example.com']);
    return wb as unknown as Book;
}

describe('cellToText', () => {
    it('passes strings through and stringifies numbers/booleans', () => {
        expect(cellToText('Alice')).toBe('Alice');
        expect(cellToText(42)).toBe('42');
        expect(cellToText(true)).toBe('TRUE');
        expect(cellToText(false)).toBe('FALSE');
    });

    it('renders null/undefined as empty', () => {
        expect(cellToText(null)).toBe('');
        expect(cellToText(undefined)).toBe('');
    });

    it('renders a pure date as YYYY-MM-DD and a datetime as full ISO', () => {
        expect(cellToText(new Date(Date.UTC(2026, 5, 7)))).toBe('2026-06-07');
        expect(cellToText(new Date(Date.UTC(2026, 5, 7, 13, 30)))).toBe('2026-06-07T13:30:00.000Z');
    });

    it('flattens rich text, hyperlinks, and formula results', () => {
        expect(cellToText({ richText: [{ text: 'Acme' }, { text: ', Inc.' }] })).toBe('Acme, Inc.');
        expect(cellToText({ text: 'mail@x.com', hyperlink: 'mailto:mail@x.com' })).toBe('mail@x.com');
        expect(cellToText({ formula: 'A1&B1', result: 'joined' })).toBe('joined');
        expect(cellToText({ error: '#REF!' })).toBe('');
    });
});

describe('rowsToCsv', () => {
    it('joins plain fields with commas and rows with newlines', () => {
        expect(rowsToCsv([['name', 'email'], ['Alice', 'a@x.com']])).toBe('name,email\nAlice,a@x.com');
    });

    it('quotes fields containing commas, quotes, or newlines (RFC 4180)', () => {
        expect(rowsToCsv([['Acme, Inc.', 'say "hi"', 'two\nlines']]))
            .toBe('"Acme, Inc.","say ""hi""","two\nlines"');
    });
});

describe('sheetChoices', () => {
    it('drops a sheet with no rows and keeps workbook-order indices', () => {
        // A blank sheet converts to an empty CSV and can never be the answer to
        // "which sheet holds the list" — Excel's own new workbook ships two of
        // them. Dropping it must NOT renumber what is left: the index is what
        // addresses `worksheets[…]` when the choice is acted on, so a
        // re-numbered list would convert the wrong sheet.
        expect(sheetChoices(threeSheetWorkbook())).toEqual([
            { index: 0, name: 'Cover' },
            { index: 2, name: 'Contacts' },
        ]);
    });

    it('offers nothing for a workbook whose every sheet is empty', () => {
        // The positive control for the case above: the filter has to meet a
        // false case somewhere, or "empty sheets are dropped" is true of an
        // implementation that drops nothing and of one that drops everything.
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('Sheet1');
        wb.addWorksheet('Sheet2');
        expect(sheetChoices(wb as unknown as Book)).toEqual([]);
    });
});

describe('workbookSheetToCsv', () => {
    it('converts the worksheet the index names, not the first one', () => {
        expect(workbookSheetToCsv(threeSheetWorkbook(), 2)).toBe(
            ['name,email', 'Alice Example,alice@example.com'].join('\n'),
        );
    });

    it('converts the FIRST worksheet when index 0 is asked for', () => {
        // Positive control for the case above: an implementation that ignores
        // `sheetIndex` and always takes `worksheets[0]` passes this one and
        // fails that one. Neither assertion alone proves the index is read.
        expect(workbookSheetToCsv(threeSheetWorkbook(), 0)).toBe('Exported by,"Acme, Inc."');
    });

    it('converts a real ExcelJS worksheet, mixed cell types and all', () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Contacts');
        ws.addRow(['name', 'email', 'phone', 'agency']);
        ws.addRow(['Alice Example', 'alice@example.com', 5551234, 'Acme, Inc.']);
        ws.addRow(['Bob "Bobby" Example', { text: 'bob@example.com', hyperlink: 'mailto:bob@example.com' }, null, '']);
        // A second sheet that this call must not reach.
        wb.addWorksheet('Ignored').addRow(['nope']);

        expect(workbookSheetToCsv(wb as unknown as Book, 0)).toBe([
            'name,email,phone,agency',
            'Alice Example,alice@example.com,5551234,"Acme, Inc."',
            '"Bob ""Bobby"" Example",bob@example.com,,',
        ].join('\n'));
    });

    it('throws a readable error when the index names no worksheet', () => {
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('One').addRow(['a']);
        wb.addWorksheet('Two').addRow(['b']);
        expect(() => workbookSheetToCsv(wb as unknown as Book, 7)).toThrow(/no worksheet/i);
    });
});
