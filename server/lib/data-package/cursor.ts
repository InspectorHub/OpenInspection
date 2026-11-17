/**
 * Stateless keyset cursors for the E-1 data-package row reader.
 *
 * A cursor is just the last row's keyset values, encoded as base64url of a
 * JSON array (e.g. `["insp-123"]`, or `["2026-01-01T00:00:00.000Z", 42]` for
 * the e-sign chain). It carries no tenant, table or job: those always come
 * from the verified job/token on the server, so a cursor minted for one tenant
 * is useless against another and cannot widen the read window. The client
 * stores `{table, cursor}` itself; the server only validates the shape against
 * the expected keyset before using the values in a bound SQL comparison.
 *
 * Decode is deliberately strict — wrong length, wrong types, NaN/Infinity,
 * oversized input or non-base64 all return null, which the route maps to
 * CURSOR_INVALID. A malformed cursor must never reach the query builder.
 */

const MAX_CURSOR_CHARS = 2048;

export type CursorValue = string | number;

function toBase64Url(s: string): string {
    // TextEncoder keeps non-ASCII ids (which JSON.stringify leaves as raw
    // unicode) from making btoa throw on characters outside Latin1.
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

/** Encode the last row's keyset values into an opaque cursor string. */
export function encodeCursor(values: readonly CursorValue[]): string {
    return toBase64Url(JSON.stringify(values));
}

/**
 * Decode and validate a cursor against an expected keyset shape.
 * Returns the values on success, or null for anything malformed. `kinds`
 * gives the expected type of each position in order.
 */
export function decodeCursor(raw: string, kinds: readonly ('string' | 'number')[]): CursorValue[] | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CURSOR_CHARS) return null;
    // Restrict to the base64url alphabet so atob never sees injected characters.
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(fromBase64Url(raw));
    } catch {
        return null;
    }
    if (!Array.isArray(parsed) || parsed.length !== kinds.length) return null;
    const out: CursorValue[] = [];
    for (let i = 0; i < kinds.length; i++) {
        const v = parsed[i];
        if (kinds[i] === 'string') {
            if (typeof v !== 'string') return null;
            out.push(v);
        } else {
            if (typeof v !== 'number' || !Number.isFinite(v)) return null;
            out.push(v);
        }
    }
    return out;
}
