/**
 * Request fingerprinting for idempotency.
 *
 * A key replayed with a DIFFERENT payload must fail loudly rather than return
 * the stored response — otherwise a user who corrects a field and resubmits
 * gets the pre-correction result back and believes the edit took. That would
 * make idempotency its own source of lost writes, which is worse than the
 * duplicates it prevents.
 *
 * Object keys are sorted so that serialization order cannot change the hash.
 * Array order is deliberately NOT sorted — [1,2] and [2,1] are different
 * requests, and treating them as equal would silently merge them.
 */
export function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export async function fingerprint(method: string, path: string, body: unknown): Promise<string> {
    const data = new TextEncoder().encode(`${method.toUpperCase()} ${path} ${canonicalize(body)}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
