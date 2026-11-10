/* ── Rule 1: columns named in raw INSERT / UPDATE must exist ──
 *
 * Pure detection, split out of check-seed-sql.mjs so a unit spec can import it
 * without running the gate (the script walks the tree and exits on import).
 */

/**
 * The SET list of an UPDATE: everything up to the first WHERE or RETURNING that is outside
 * quotes and outside parentheses. A WHERE inside a subquery (`SET a = (SELECT x FROM y WHERE
 * z = ?), bad = ?`) or inside a string literal (`SET note = 'WHERE', bad = ?`) does not end it.
 */
export function setListOf(text) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === '(') { depth += 1; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
        if (depth === 0 && (i === 0 || /\W/.test(text[i - 1])) && /^(?:WHERE|RETURNING)\b/i.test(text.slice(i))) {
            return text.slice(0, i);
        }
    }
    return text;
}

/** Split on a separator outside quotes and parentheses, so function and subquery commas stay inside. */
export function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts;
}

/** @returns {{table:string, column:string, index:number}[]} */
export function rawSqlColumnRefs(src) {
    const refs = [];

    // INSERT [OR REPLACE|IGNORE] INTO <table> (a, b, c)
    for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([a-z0-9_]+)"?\s*\(([^)]*)\)/gi)) {
        for (const raw of m[2].split(',')) {
            const column = raw.trim().replace(/^["'`]|["'`]$/g, '');
            if (/^[a-z0-9_]+$/i.test(column)) {
                refs.push({ table: m[1], column, index: m.index });
            }
        }
    }

    // UPDATE <table> SET col = ..., col2 = ... [WHERE ...]
    //
    // Only the SET list names written columns, so the body stops at WHERE /
    // RETURNING, and a fragment counts only when it has the `column =` shape.
    // The old reading took everything up to a `;` or backtick: in
    //   'UPDATE t SET data = ? WHERE tenant_id = ?', .bind(x, tenantId)
    // the closing quote did not end the body, so the JS arguments after the
    // string were split on commas and `tenantId` was read as a written column.
    //
    // Known limit: an UPDATE with no WHERE or RETURNING inside a quoted JS string still reads the
    // JS that follows the string, up to the next `;` or backtick, so a `col =` shape there is reported.
    for (const m of src.matchAll(/UPDATE\s+"?([a-z0-9_]+)"?\s+SET\s+([^;`]*)/gi)) {
        for (const assignment of splitTopLevel(setListOf(m[2]), ',')) {
            const named = /^\s*["'`]?([a-z0-9_]+)["'`]?\s*=(?!=)/i.exec(assignment);
            if (named) refs.push({ table: m[1], column: named[1], index: m.index });
        }
    }

    return refs;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

export function findSeedSqlViolations(src, filename, schema) {
    const out = [];
    const lines = src.split('\n');
    const allowed = (line) => /seed-lint-ok:/.test(lines[line - 1] ?? '');

    const touchedMsColumns = [];

    for (const { table, column, index } of rawSqlColumnRefs(src)) {
        const columns = schema.tables.get(table);
        if (!columns) continue;  // not one of ours (D1 internals, portal-side)
        const line = lineOf(src, index);
        if (!columns.has(column)) {
            if (allowed(line)) continue;
            out.push(
                `${filename}:${line} writes ${table}.${column}, which does not exist in the schema`,
            );
        } else if (schema.msColumns.get(table)?.has(column)) {
            touchedMsColumns.push({ table, column, line });
        }
    }

    // Rule 2 — seconds into a millisecond column.
    if (touchedMsColumns.length > 0) {
        const secondsAt = src.split('\n').findIndex(l =>
            /Date\.now\(\)\s*\/\s*1000/.test(l) && !/seed-lint-ok:/.test(l));
        if (secondsAt !== -1) {
            const { table, column } = touchedMsColumns[0];
            out.push(
                `${filename}:${secondsAt + 1} computes SECONDS (Date.now() / 1000) but this file ` +
                `writes ${table}.${column}, which is timestamp_ms — the row will read as 1970`,
            );
        }
    }

    return out;
}

