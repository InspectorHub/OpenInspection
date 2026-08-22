import { logger } from '../../logger';
import { readZipEntry } from './zip';

/**
 * The parts of the workbook format this reader names.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: PUBLIC STANDARD VALUE. The archive path of the
 * first worksheet and the element that holds its rows are both named by the
 * published spreadsheet specification, not by any product.
 */
const OOXML = {
    firstWorksheet: 'xl/worksheets/sheet1.xml',
    sheetData: '<sheetData',
} as const;

/**
 * The first worksheet of an XLSX, as rows of strings.
 *
 * ── Why this exists rather than a library ───────────────────────────────────
 * The Worker bundle ceiling is 3 MiB gzipped and a self-hosted deploy fails
 * above it. The spreadsheet library already in this repository is a
 * Node-oriented browser build used client-side. What a vendor export needs is
 * one sheet, no styles, no formulas — which is this file.
 *
 * ── What a real export taught this reader ───────────────────────────────────
 * Two things a generated workbook would not have shown:
 *
 *  1. `sharedStrings.xml` can be EMPTY, every value inline as `t="str"` with a
 *     `<v>`. A reader built against shared strings sees a blank sheet, reports
 *     zero sections, and is not obviously broken.
 *  2. Text can be escaped TWICE — the XML holds `&amp;amp;`. The exporting
 *     product escapes its own stored content and the XML writer escapes that,
 *     so a single decode leaves an entity where a section name should be.
 *
 * Both are the exporting product's, not the format's, and neither is guessable.
 */
export async function readXlsxSheet(bytes: Uint8Array): Promise<string[][] | null> {
    const xml = await readZipEntry(bytes, OOXML.firstWorksheet);
    if (xml === null) return null;
    const text = new TextDecoder().decode(xml);
    if (!text.includes(OOXML.sheetData)) return null;

    const rows: string[][] = [];
    let width = 0;
    for (const rowXml of text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cellXml of rowXml[1]!.matchAll(/<c\b[^>]*r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
            const index = columnIndex(cellXml[1]!);
            const value = cellXml[2]!.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
            while (cells.length < index) cells.push('');
            cells[index] = decodeCellText(value);
        }
        width = Math.max(width, cells.length);
        rows.push(cells);
    }
    // Pad short rows so a column index means the same thing on every row. A
    // ragged result makes "column 5 is the comment type" true only sometimes,
    // and the row it is false on is the one nobody checks.
    for (const row of rows) while (row.length < width) row.push('');
    if (rows.length === 0) {
        logger.warn('[intake] worksheet parsed with no rows');
        return null;
    }
    return rows;
}

/** `A` → 0, `Z` → 25, `AA` → 26. Column letters are base-26 with no zero digit. */
function columnIndex(letters: string): number {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/**
 * One pass of XML entity decoding.
 *
 * ⚠️ `&amp;` is replaced LAST. Replacing it first turns `&amp;lt;` into `&lt;`
 * and then into `<` within the same pass — two passes' worth of decoding done
 * in one, which would make the bound below meaningless.
 */
function decodeOnce(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Whether a string still carries one of the five entities decoding handles. */
const ENTITY = /&(lt|gt|quot|apos|amp);/;

/**
 * A cell's text, decoded AT MOST TWICE.
 *
 * Twice, not once and not to a fixed point, and the number is the observed
 * escaping depth rather than a convenience. Once is too few: the real export
 * holds `&amp;amp;`, and stopping there prints `&amp;` in the middle of a
 * section name. A fixed point is too many and has no floor — it would take a
 * cell whose genuine content is the TEXT `&amp;` all the way down to `&`, and
 * nothing would stop it.
 *
 * So the cost of this rule is exactly one case: a cell whose true content is a
 * single-escaped entity. That has never been observed, while the double
 * escaping is in every export measured, and a bounded rule can be re-measured
 * where an unbounded one cannot.
 */
function decodeCellText(s: string): string {
    const once = decodeOnce(s);
    return ENTITY.test(once) ? decodeOnce(once) : once;
}
