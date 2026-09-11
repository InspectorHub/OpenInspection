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
 * Three things, none of them guessable from the specification:
 *
 *  1. `sharedStrings.xml` can be EMPTY, every value inline as `t="str"` with a
 *     `<v>`. A reader built against shared strings sees a blank sheet, reports
 *     zero sections, and is not obviously broken.
 *  2. Text can be escaped TWICE — the XML holds `&amp;amp;`. The exporting
 *     product escapes its own stored content and the XML writer escapes that,
 *     so a single decode leaves an entity where a section name should be.
 *  3. A cell can hold its text with no `<v>` at all, as `t="inlineStr"` with
 *     `<is><t>`. That is what a script-written workbook looks like, and it is
 *     the same silent blank as (1) — see `inlineStringOf`.
 *
 * (1) and (2) are the exporting product's. (3) is whatever wrote the file.
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
            const value = cellXml[2]!.match(/<v>([\s\S]*?)<\/v>/)?.[1]
                ?? inlineStringOf(cellXml[2]!)
                ?? '';
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

/**
 * The text of a `t="inlineStr"` cell, or undefined when the cell is not one.
 *
 * The third thing above, and the one that fails most quietly. A workbook written
 * by a script — openpyxl is the common case — puts every string in
 * `<is><t>…</t></is>` and emits NO `<v>` anywhere. A reader that knows only
 * `<v>` then returns a full-size grid of empty strings: not null, not an error,
 * and past the zero-rows guard, so the run downstream reports a file with
 * nothing in it. One real upload sat waiting on a person for thirteen days that
 * way — 539 inline strings read as 539 blanks.
 *
 * Every `<t>` inside the `<is>` is concatenated, because rich text splits one
 * string across runs (`<r><t>a</t></r><r><t>b</t></r>`) and taking the first
 * alone would truncate it without saying so. The attribute group is optional in
 * the match because `<t>` commonly carries `xml:space="preserve"`.
 */
function inlineStringOf(cellBody: string): string | undefined {
    const inline = cellBody.match(/<is>([\s\S]*?)<\/is>/)?.[1];
    if (inline === undefined) return undefined;
    let text = '';
    for (const run of inline.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += run[1];
    return text;
}

/** `A` → 0, `Z` → 25, `AA` → 26. Column letters are base-26 with no zero digit. */
function columnIndex(letters: string): number {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/**
 * One character, from a decimal or hex numeric reference, or null when the
 * number is not a character.
 *
 * Null rather than a throw, and that is the whole reason this is a function. A
 * reference out of Unicode's range makes `fromCodePoint` throw, and a throw here
 * fails the whole import over one bad cell — so a number that is not a character
 * is left in the text as the author wrote it, visible to the operator, instead
 * of taking the other forty thousand cells down with it.
 */
function charOfReference(digits: string, radix: number): string | null {
    const code = parseInt(digits, radix);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
    // Lone surrogates are representable here but are not characters; a file
    // carrying one is malformed and keeping the reference says so.
    if (code >= 0xd800 && code <= 0xdfff) return null;
    return String.fromCodePoint(code);
}

/**
 * One pass of XML entity decoding.
 *
 * ⚠️ `&amp;` is replaced LAST. Replacing it first turns `&amp;lt;` into `&lt;`
 * and then into `<` within the same pass — two passes' worth of decoding done
 * in one, which would make the bound below meaningless.
 *
 * NUMERIC REFERENCES are handled alongside the five names because a writer
 * reaches for them constantly and nothing else in this pipeline decodes them: a
 * script-written workbook holds `&#8212;` for an em dash and `&#9744;` for a
 * ballot box, and a reader that knows only the named five imports those as
 * literal `&#8212;` into an item's label — where it reads as a typo in somebody
 * else's template rather than as a decoding bug. `&#x2014;` is the same
 * reference written in hex and must not be the case that is missed.
 */
function decodeOnce(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d{1,7});/g, (whole, d: string) => charOfReference(d, 10) ?? whole)
        .replace(/&#x([0-9a-fA-F]{1,6});/g, (whole, h: string) => charOfReference(h, 16) ?? whole)
        .replace(/&amp;/g, '&');
}

/** Whether a string still carries an entity decoding handles. */
const ENTITY = /&(lt|gt|quot|apos|amp|#\d{1,7}|#x[0-9a-fA-F]{1,6});/;

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
