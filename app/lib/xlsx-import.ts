/**
 * .xlsx → CSV conversion for the contacts import modal.
 *
 * Parsing happens entirely CLIENT-side: the vendored ExcelJS browser build
 * (`public/vendor/exceljs.min.js`, copied by scripts/vendor-copy.js) is
 * script-injected on first use — it is ~940KB and must never enter the worker
 * bundle or the initial client chunk. The first worksheet is converted to CSV
 * text and fed into the existing paste-box → validate → atomic-import
 * pipeline, so the server import path needs zero changes.
 *
 * Legacy `.xls` (the 2003 binary format) is intentionally unsupported —
 * ExcelJS does not read it; users save as .xlsx or CSV.
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

interface ExcelJsGlobal {
    Workbook: new () => WorkbookLike & { xlsx: { load: (buf: ArrayBuffer) => Promise<unknown> } };
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

const VENDOR_SRC = '/vendor/exceljs.min.js';
let excelJsLoading: Promise<ExcelJsGlobal> | null = null;

/** Inject the vendored ExcelJS browser build once and resolve its global. */
function loadExcelJs(): Promise<ExcelJsGlobal> {
    excelJsLoading ??= new Promise((resolve, reject) => {
        const existing = (window as unknown as { ExcelJS?: ExcelJsGlobal }).ExcelJS;
        if (existing) { resolve(existing); return; }
        const s = document.createElement('script');
        s.src = VENDOR_SRC;
        s.onload = () => {
            const g = (window as unknown as { ExcelJS?: ExcelJsGlobal }).ExcelJS;
            if (g) resolve(g);
            else reject(new Error('ExcelJS failed to initialize.'));
        };
        s.onerror = () => {
            excelJsLoading = null; // allow a retry on transient load failure
            reject(new Error('Could not load the spreadsheet parser.'));
        };
        document.head.appendChild(s);
    });
    return excelJsLoading;
}

/** Browser entry point: File (.xlsx) → CSV text for the import pipeline. */
export async function parseXlsxFile(file: File): Promise<string> {
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    return workbookFirstSheetToCsv(wb);
}
