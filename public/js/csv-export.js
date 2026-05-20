/**
 * Design System 0520 subsystem E P3.1 — CSV serialiser + download helper.
 *
 * Two pure helpers + one DOM helper. RFC 4180 baseline:
 *   • Header row derived from the FIRST row's keys (preserves column
 *     order — JS engines maintain insertion order for non-numeric
 *     string keys).
 *   • Values are wrapped in double-quotes when they contain comma,
 *     newline (LF or CR), or a double-quote. Embedded double-quotes
 *     are escaped by doubling them.
 *   • null / undefined render as empty strings (NOT 'null' or
 *     'undefined' — the dashboard exporter relies on this).
 *
 * `toCsv` is the unit-testable surface; `downloadCsv` does the
 * Blob + anchor click in the browser.
 */

export function toCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const headers = Object.keys(rows[0]);
    const escape = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\r\n]/.test(s)
            ? `"${s.replace(/"/g, '""')}"`
            : s;
    };

    const headerLine = headers.map(escape).join(',');
    const lines = rows.map((row) =>
        headers.map((h) => escape(row[h])).join(','),
    );
    return [headerLine, ...lines].join('\n');
}

export function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
