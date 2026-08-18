/**
 * The CSV tokeniser for the intake path — adapters and the contacts importer
 * both read a file through this one function.
 *
 * It lives here rather than next to a writer because the adapter layer needs
 * it and may not depend on anything that touches the database. Sharing one
 * tokeniser across a single import matters: a looser second one splits a
 * quoted header containing a comma into a different number of columns, and the
 * preview and the commit then disagree about which column is which.
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

export function parseCsvPreview(csv: string): CsvPreviewResult {
    const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return { columns: [], rows: [], totalRowsDetected: 0, truncated: false };
    const columns = parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);
    const totalRowsDetected = dataLines.length;
    const previewLines = dataLines.slice(0, MAX_PREVIEW_ROWS);
    const rows = previewLines.map((line) => {
        const fields = parseCsvLine(line);
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
    const raw = csv.split(/\r?\n/);
    const kept: { text: string; line: number }[] = [];
    raw.forEach((text, i) => { if (text.length > 0) kept.push({ text, line: i + 1 }); });
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
