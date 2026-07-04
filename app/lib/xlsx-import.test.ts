/**
 * .xlsx contacts import — pure conversion layer (app/lib/xlsx-import.ts).
 *
 * The modal parses the workbook CLIENT-side (vendored exceljs browser build,
 * script-injected on demand) and converts the first worksheet to CSV text
 * that feeds the existing paste-box → validate → atomic-import pipeline, so
 * the backend needs zero changes. These tests drive the conversion against
 * REAL ExcelJS workbook objects (the node build of the same library) — the
 * browser wrapper only differs in how the library is loaded.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { cellToText, rowsToCsv, workbookFirstSheetToCsv } from '~/lib/xlsx-import';

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

describe('workbookFirstSheetToCsv', () => {
    it('converts the first worksheet of a real ExcelJS workbook, mixed cell types and all', () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Contacts');
        ws.addRow(['name', 'email', 'phone', 'agency']);
        ws.addRow(['Alice Example', 'alice@example.com', 5551234, 'Acme, Inc.']);
        ws.addRow(['Bob "Bobby" Example', { text: 'bob@example.com', hyperlink: 'mailto:bob@example.com' }, null, '']);
        // A second sheet that must be IGNORED (first sheet wins).
        wb.addWorksheet('Ignored').addRow(['nope']);

        expect(workbookFirstSheetToCsv(wb as unknown as Parameters<typeof workbookFirstSheetToCsv>[0])).toBe([
            'name,email,phone,agency',
            'Alice Example,alice@example.com,5551234,"Acme, Inc."',
            '"Bob ""Bobby"" Example",bob@example.com,,',
        ].join('\n'));
    });

    it('throws a readable error when the workbook has no worksheet', () => {
        const wb = new ExcelJS.Workbook();
        expect(() => workbookFirstSheetToCsv(wb as unknown as Parameters<typeof workbookFirstSheetToCsv>[0]))
            .toThrow(/no worksheet/i);
    });
});
