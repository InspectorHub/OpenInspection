/**
 * The CSV tokeniser for the intake path — adapters and the contacts importer
 * both read a file through this one function.
 *
 * It lives here rather than next to a writer because the adapter layer needs
 * it and may not depend on anything that touches the database. Sharing one
 * tokeniser across a single import matters: a looser second one splits a
 * quoted header containing a comma into a different number of columns, and the
 * preview and the commit then disagree about which column is which.
 *
 * ── Records, not lines ──────────────────────────────────────────────────────
 * That warning used to apply to the tokeniser and not to the SPLIT, and the
 * split is where the same failure was actually happening. Both readers below
 * cut the file on `/\r?\n/` before tokenising anything, so a quoted field
 * containing a newline was torn in half: the continuation became a row of its
 * own, every column after it shifted, and nothing counted what was lost — the
 * file is still well-formed CSV, so there is no parse error to report.
 *
 * `splitCsvRecords` therefore does the quote tracking ONCE, for both readers,
 * and a record ends at a newline only when it is outside quotes. This is not a
 * hypothetical shape: the contacts export quotes a multi-line note, so our own
 * export was unreadable by our own importer.
 */

const MAX_PREVIEW_ROWS = 20;

export interface CsvPreviewResult {
    columns: string[];
    rows: Record<string, string>[];
    totalRowsDetected: number;
    truncated: boolean;
}

/**
 * Tokenises a single CSV line respecting double-quoted fields (RFC 4180 lite).
 * Embedded `""` escapes a literal quote. Commas outside quotes split fields.
 */
export function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { cur += ch; }
        } else {
            if (ch === ',') { out.push(cur); cur = ''; }
            else if (ch === '"' && cur === '') { inQuotes = true; }
            else { cur += ch; }
        }
    }
    out.push(cur);
    return out;
}

/** One logical record, and the 1-based line of the file it STARTED on. */
export interface CsvRecord {
    text: string;
    line: number;
}

/**
 * The file as records.
 *
 * One pass, tracking whether the cursor sits inside a quoted field, ending a
 * record at `\n` (and at `\r\n`) only OUTSIDE quotes. Empty records are
 * skipped, exactly as both readers used to skip empty lines — a spreadsheet
 * program trailing a blank line is common, and keeping it would turn every
 * such file into one empty row.
 *
 * `line` is where the record STARTED, not where it ended: a repair sentence
 * pointing at the wrong line is barely better than no sentence, because the
 * operator still has to find the row in their spreadsheet.
 *
 * An unterminated quote ends as one final record rather than as a throw. A
 * malformed file has to reach the repair screen, not a 500.
 */
export function splitCsvRecords(csv: string): CsvRecord[] {
    const records: CsvRecord[] = [];
    let cur = '';
    let inQuotes = false;
    let line = 1;
    let startLine = 1;

    const flush = () => {
        if (cur.length > 0) records.push({ text: cur, line: startLine });
        cur = '';
        startLine = line;
    };

    for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        if (ch === '"') {
            // A quote only OPENS a field when the field is still empty, which
            // is the same rule `parseCsvLine` applies — the two must agree
            // about where a quoted field begins or they will disagree about
            // where the record ends.
            const atFieldStart = cur.length === 0 || cur.endsWith(',') || cur.endsWith('\n');
            if (inQuotes) {
                if (csv[i + 1] === '"') { cur += '""'; i++; continue; }
                inQuotes = false;
            } else if (atFieldStart) {
                inQuotes = true;
            }
            cur += ch;
            continue;
        }
        if (!inQuotes && ch === '\n') {
            const text = cur.endsWith('\r') ? cur.slice(0, -1) : cur;
            if (text.length > 0) records.push({ text, line: startLine });
            cur = '';
            line += 1;
            startLine = line;
            continue;
        }
        if (ch === '\n') line += 1;
        cur += ch;
    }
    flush();
    return records;
}

export function parseCsvPreview(csv: string): CsvPreviewResult {
    const records = splitCsvRecords(csv);
    if (records.length === 0) return { columns: [], rows: [], totalRowsDetected: 0, truncated: false };
    const columns = parseCsvLine(records[0].text);
    const dataRecords = records.slice(1);
    const totalRowsDetected = dataRecords.length;
    const rows = dataRecords.slice(0, MAX_PREVIEW_ROWS).map((record) => {
        const fields = parseCsvLine(record.text);
        const row: Record<string, string> = {};
        columns.forEach((col, i) => { row[col] = fields[i] ?? ''; });
        return row;
    });
    return { columns, rows, totalRowsDetected, truncated: totalRowsDetected > MAX_PREVIEW_ROWS };
}

/**
 * The whole file, uncapped, keyed by header.
 *
 * `lineNumbers[i]` is the 1-based line number in the ORIGINAL file that
 * produced `rows[i]`. Reporting a problem against a row index the operator
 * cannot find in their spreadsheet is barely better than not reporting it.
 */
export function parseCsvTable(csv: string): {
    columns: string[];
    rows: Record<string, string>[];
    lineNumbers: number[];
} {
    const kept = splitCsvRecords(csv);
    if (kept.length === 0) return { columns: [], rows: [], lineNumbers: [] };
    const columns = parseCsvLine(kept[0].text);
    const rows: Record<string, string>[] = [];
    const lineNumbers: number[] = [];
    for (const entry of kept.slice(1)) {
        const fields = parseCsvLine(entry.text);
        const row: Record<string, string> = {};
        columns.forEach((col, i) => { row[col] = fields[i] ?? ''; });
        rows.push(row);
        lineNumbers.push(entry.line);
    }
    return { columns, rows, lineNumbers };
}
