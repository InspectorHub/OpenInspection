/**
 * Read-side normalisation for JSON stored in a `text(..., { mode: 'json' })`
 * column.
 *
 * Such a column serialises on write and parses on read. A writer that hands it
 * an already-stringified value therefore stores a JSON string literal, and a
 * read returns a string instead of an object. Rows written that way exist, so
 * every reader must accept both shapes. This is the one place that does it.
 */

/** Parse at most two layers of string wrapping. Unparseable text yields null. */
export function normalizeStoredJson(raw: unknown): unknown {
    let value = raw;
    for (let layer = 0; layer < 2 && typeof value === 'string'; layer++) {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    // Still a string after two layers: not a shape we write, treat as unreadable.
    return typeof value === 'string' ? null : value;
}

/** Like `normalizeStoredJson`, but only a plain JSON object is accepted. */
export function normalizeStoredObject(raw: unknown): Record<string, unknown> | null {
    const value = normalizeStoredJson(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}
