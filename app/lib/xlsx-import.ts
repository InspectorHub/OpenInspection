/**
 * Workbook → CSV conversion. NO PRODUCTION CALLER — read the next paragraph
 * before building on this.
 *
 * It served the contacts import modal, which parsed the workbook CLIENT-side
 * through a vendored ExcelJS browser build and fed the resulting CSV text into
 * the paste box. That modal is gone: bringing contacts over is one run in the
 * import wizard, which uploads the file itself and reads it on the server.
 *
 * What is left is the pure conversion layer, and the only thing that calls it
 * is its own test. It is kept rather than deleted because the ExcelJS
 * dependency it is written against is reachable from nowhere else, so retiring
 * this file means retiring a dependency and the `scripts/vendor-copy.js` entry
 * that ships it — a change with its own blast radius, not a line in an import
 * task.
 *
 * ⚠️ It is NOT the spreadsheet reader the intake path uses. That one is
 * hand-written, dependency-free and server-side, under
 * `server/lib/migration-intake/`. Two readers, and this is the one nothing
 * runs.
 */

/** The slice of the ExcelJS API this module consumes (browser and node
 *  builds are identical here; tests drive the node build through it). */
export interface WorkbookLike {
    worksheets: Array<{
        eachRow: (
            opts: { includeEmpty: boolean },
            cb: (row: { values: unknown }, rowNumber: number) => void,
        ) => void;
    }>;
}

/** Normalize one ExcelJS cell value to display text. Covers the value union
 *  ExcelJS produces: primitives, Date, rich text, hyperlink, formula
 *  (rendered via its cached result), and error cells (rendered empty). */
export function cellToText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date) {
        const iso = v.toISOString();
        // Pure dates (midnight UTC) read as YYYY-MM-DD, not an ISO timestamp.
        return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
    }
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.richText)) {
            return o.richText.map((r) => cellToText((r as Record<string, unknown>).text)).join('');
        }
        if ('text' in o) return cellToText(o.text);
        if ('result' in o) return cellToText(o.result);
        if ('error' in o) return '';
    }
    return String(v);
}

/** RFC 4180-style serializer — quote fields containing commas, quotes, or
 *  newlines; double embedded quotes. Mirror image of the import parser. */
export function rowsToCsv(rows: string[][]): string {
    const field = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    return rows.map((r) => r.map(field).join(',')).join('\n');
}

/** First worksheet → CSV text. ExcelJS `row.values` is a 1-based sparse
 *  array (index 0 unused); empty rows are skipped (the CSV importer ignores
 *  blank lines anyway). */
export function workbookFirstSheetToCsv(workbook: WorkbookLike): string {
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('The .xlsx file contains no worksheet.');
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
        rows.push(values.map(cellToText));
    });
    return rowsToCsv(rows);
}

// A `parseXlsxFile(file)` stood here: it script-injected `/vendor/exceljs.min.js`
// into the page on first use, loaded the workbook from the File, and returned
// CSV text. Its one caller was the contacts import modal. It went with it —
// a browser entry point nothing enters is not a capability, it is 940KB of
// vendored parser that only a stale import could reach.
