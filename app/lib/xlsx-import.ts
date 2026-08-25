/**
 * Workbook → CSV conversion, in the BROWSER, for the import upload form.
 *
 * `StartImportPanel` parses a chosen `.xlsx` with the vendored ExcelJS build
 * (`~/lib/xlsx-loader`), asks which sheet holds the list when more than one has
 * rows, converts that one sheet here, and puts the CSV back into the same file
 * input. The server then receives a `.csv` and reads it exactly as it reads any
 * other — which is the whole point of doing this here: the mapping step, the
 * preview step and the intake API need no knowledge that a workbook was ever
 * involved.
 *
 * This layer is PURE. No DOM, no ExcelJS import, no `File`: it takes a
 * `WorkbookLike` and returns text, so it is driven in tests by the node build
 * of the same library that the browser loads by URL.
 *
 * ⚠️ It is NOT the spreadsheet reader the intake path uses. That one is
 * hand-written, dependency-free and server-side, under
 * `server/lib/migration-intake/`, and it stays there: generalising it means
 * shipping a full XLSX reader into a worker with a 3 MiB gzip ceiling. Two
 * readers, on purpose, on two sides of the wire.
 */

/** The slice of the ExcelJS API this module consumes (browser and node
 *  builds are identical here; tests drive the node build through it). */
export interface WorkbookLike {
    worksheets: Array<{
        name: string;
        rowCount: number;
        eachRow: (
            opts: { includeEmpty: boolean },
            cb: (row: { values: unknown }, rowNumber: number) => void,
        ) => void;
    }>;
}

/** One sheet the operator may choose. `index` indexes `workbook.worksheets`. */
export interface SheetChoice {
    index: number;
    name: string;
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

/**
 * The sheets that could be an answer, in workbook order.
 *
 * A sheet with no rows is dropped: Excel's default new workbook carries blank
 * `Sheet2`/`Sheet3`, and offering one would put an answer on the list that
 * converts to an empty CSV whoever picks it.
 *
 * ⚠️ `index` is the position in `workbook.worksheets`, NOT the position in the
 * returned list. Dropping a blank sheet must not renumber the ones behind it,
 * because the index is what `workbookSheetToCsv` addresses the sheet by.
 */
export function sheetChoices(workbook: WorkbookLike): SheetChoice[] {
    return workbook.worksheets
        .map((sheet, index) => ({ index, name: sheet.name, rowCount: sheet.rowCount }))
        .filter((s) => s.rowCount > 0)
        .map(({ index, name }) => ({ index, name }));
}

/** One worksheet → CSV text. ExcelJS `row.values` is a 1-based sparse array
 *  (index 0 unused); empty rows are skipped (the CSV importer ignores blank
 *  lines anyway). */
export function workbookSheetToCsv(workbook: WorkbookLike, sheetIndex: number): string {
    const sheet = workbook.worksheets[sheetIndex];
    if (!sheet) throw new Error(`The .xlsx file contains no worksheet at index ${sheetIndex}.`);
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
        rows.push(values.map(cellToText));
    });
    return rowsToCsv(rows);
}
