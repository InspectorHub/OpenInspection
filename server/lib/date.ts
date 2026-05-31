/**
 * Safely coerce any D1 date value (Date object, unix epoch integer,
 * ISO string, or SQLite datetime text) to an ISO 8601 string.
 *
 * D1 may return dates in different formats depending on how they were
 * inserted (Drizzle ORM → Date, raw SQL unixepoch() → number,
 * datetime('now') → string like "2026-04-22 01:42:37").
 */
export function safeISODate(v: unknown): string {
    try {
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'number') return new Date(v * 1000).toISOString();
        if (typeof v === 'string' && v) {
            const d = new Date(v.includes('T') ? v : v + 'Z');
            return isNaN(d.getTime()) ? v : d.toISOString();
        }
    } catch { /* fall through */ }
    return String(v ?? '');
}

/**
 * Safely extract a unix-millisecond timestamp from a D1 date value.
 * Returns NaN if the value cannot be parsed.
 */
export function safeTimestamp(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v * 1000;
    if (typeof v === 'string' && v) {
        const d = new Date(v.includes('T') ? v : v + 'Z');
        return d.getTime(); // NaN if invalid
    }
    return NaN;
}
