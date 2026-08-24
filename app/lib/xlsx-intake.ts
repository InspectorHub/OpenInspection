/**
 * The name questions the browser workbook reader has to answer, and nothing
 * else.
 *
 * Kept apart from `~/lib/xlsx-loader` (which touches the DOM) and from
 * `~/lib/xlsx-import` (which takes a parsed workbook) because both of these are
 * decisions about a STRING: which files this reader claims, and what to call
 * the CSV it hands back. That keeps them assertable in a node spec, and it
 * keeps the one fact the server depends on — the `.csv` suffix — in a file with
 * no reason ever to import a parser.
 */

/**
 * The workbook formats this browser reader claims. `.xlsx` only.
 *
 * `.xls` is absent because ExcelJS cannot read the pre-2007 binary format at
 * all: claiming it would take a file that reaches a person today, whole, and
 * turn it into a parse error in the browser.
 *
 * `.xlsm` is absent for an unrelated reason, recorded in the design spec's
 * *Open findings* — the server's own suffix handling of it belongs to whoever
 * owns the intake formats, and widening this list would route more traffic onto
 * that path before it is settled.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — the format this
 * reader claims, not a list read out of any file.
 */
export const WORKBOOK_SUFFIXES: readonly string[] = ['.xlsx'];

/** Whether this reader claims the file, by name alone. The name is all there
 *  is at the moment a file is chosen; nothing has read a byte yet. */
export function isWorkbookFileName(fileName: string): boolean {
    const name = fileName.trim().toLowerCase();
    return WORKBOOK_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * What to call the CSV built from one sheet of a workbook.
 *
 * e.g. `('Contacts export.xlsx', 'Sheet 1')` -> `'Contacts export - Sheet 1.csv'`.
 *
 * ⚠️ The `.csv` ending is a CONTRACT with the server, not decoration: the
 * intake path reads the uploaded name exactly once, through `extForFileName`,
 * and that call decides both the size cap the upload is measured against and
 * the content type the stored object is written with. Every character outside
 * `[A-Za-z0-9 _-]` is replaced so a sheet named `2024.xlsx` cannot smuggle a
 * second suffix past it. The pairing is asserted across the module boundary in
 * `tests/unit/migration-intake/browser-csv-upload-contract.spec.ts`.
 */
export function csvFileNameFor(workbookFileName: string, sheetName: string): string {
    const lower = workbookFileName.toLowerCase();
    const suffix = WORKBOOK_SUFFIXES.find((s) => lower.endsWith(s));
    const base = suffix ? workbookFileName.slice(0, -suffix.length) : workbookFileName;
    const safeSheet = sheetName.replace(/[^A-Za-z0-9 _-]/g, '-');
    return `${base} - ${safeSheet}.csv`;
}
