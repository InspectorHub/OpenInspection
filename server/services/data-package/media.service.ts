/**
 * E-2 media enumeration + Range download service.
 *
 * The desktop client lists tenant media and streams each object in ranged
 * chunks into its own zip volumes. This service is the dumb-Worker boundary:
 * it lists only the verified tenant's R2 prefix minus platform-owned prefixes,
 * and streams a single object with RFC 9110 Range semantics. It never groups,
 * hashes or verifies bytes — that stays on the client.
 *
 * Security: every key is validated BEFORE any R2 call. A relative key may not
 * be absolute, contain a separator traversal, a backslash, a control character
 * or an unpaired surrogate (keyProblem), and may not begin with an excluded
 * platform prefix. Callers always pass the verified tenant id; a key that
 * already carries a different `${tenantId}/` prefix is refused as cross-tenant.
 */
import { resolveByteRange } from '../../lib/media/serve-video';
import { keyProblem } from '@core/data-package';

/** Prefixes under the tenant root owned by the platform, never part of an export. */
const EXCLUDED_MEDIA_PREFIXES = ['exports/', 'migrations/', '_platform/'] as const;

const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;

interface MediaObjectInfo {
    /** Key relative to the tenant prefix (e.g. `inspections/i/photos/a.jpg`). */
    readonly key: string;
    readonly size: number;
    readonly etag: string;
    /** Epoch milliseconds from the R2 object's uploaded date. */
    readonly uploaded: number;
    readonly contentType: string;
}

export interface MediaListPage {
    readonly objects: MediaObjectInfo[];
    /** Opaque continuation cursor, set when `truncated`. */
    readonly cursor: string | null;
    readonly truncated: boolean;
}

function isExcluded(relativeKey: string): boolean {
    return EXCLUDED_MEDIA_PREFIXES.some((p) => relativeKey.startsWith(p));
}

/** Relative key validation shared by list filtering and open gating. */
function usableRelativeKey(relativeKey: string): boolean {
    return keyProblem(relativeKey) === null && !isExcluded(relativeKey);
}

/**
 * Decode a list cursor into the last seen relative key. Cursors are opaque to
 * the client but must not be trusted: a malformed/garbage cursor is dropped
 * (restart the list) rather than throwing, so a stale cursor never wedges an
 * export. We accept base64url(JSON({k})) with a plain-string last key.
 */
function toBase64Url(s: string): string {
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

function decodeCursor(raw: string | undefined): string | null {
    if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    try {
        const value: unknown = JSON.parse(fromBase64Url(raw));
        if (typeof value !== 'object' || value === null) return null;
        const k = (value as { k?: unknown }).k;
        return typeof k === 'string' && usableRelativeKey(k) ? k : null;
    } catch {
        return null;
    }
}

function encodeCursor(lastKey: string): string {
    return toBase64Url(JSON.stringify({ k: lastKey }));
}

export class DataPackageMediaService {
    constructor(private readonly bucket: R2Bucket) {}

    /**
     * List one page of exportable media for the tenant. Keys are returned
     * relative to the tenant prefix. A malformed cursor restarts from the top;
     * the caller should treat a repeated first page as a cursor to discard.
     */
    async list(tenantId: string, cursor?: string, limit?: number): Promise<MediaListPage> {
        const pageSize = Number.isFinite(limit) && limit! > 0
            ? Math.min(Math.floor(limit!), MAX_PAGE_SIZE)
            : DEFAULT_PAGE_SIZE;
        const after = decodeCursor(cursor);
        const prefix = `${tenantId}/`;
        const objects: MediaObjectInfo[] = [];
        let seenAfter = after === null;
        let lastKey = '';
        let truncated = false;

        // R2 list is prefix + opaque cursor. We page through the raw listing,
        // filtering platform prefixes, until we have `pageSize` usable objects
        // or the listing ends. The returned cursor is the last usable key.
        let r2Cursor: string | undefined;
        do {
            const page: R2Objects = await this.bucket.list({
                prefix,
                limit: MAX_PAGE_SIZE,
                ...(r2Cursor ? { cursor: r2Cursor } : {}),
            });
            for (const obj of page.objects) {
                const relativeKey = obj.key.slice(prefix.length);
                if (!usableRelativeKey(relativeKey)) continue;
                if (!seenAfter) {
                    if (relativeKey === after) seenAfter = true;
                    continue;
                }
                if (objects.length >= pageSize) {
                    truncated = true;
                    break;
                }
                const uploaded = obj.uploaded instanceof Date
                    ? obj.uploaded.getTime()
                    : Date.parse(String(obj.uploaded));
                objects.push({
                    key: relativeKey,
                    size: obj.size,
                    etag: obj.etag ?? '',
                    uploaded: Number.isFinite(uploaded) ? uploaded : 0,
                    contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
                });
                lastKey = relativeKey;
            }
            if (truncated) break;
            r2Cursor = page.truncated ? page.cursor : undefined;
        } while (r2Cursor);

        return { objects, cursor: truncated ? encodeCursor(lastKey) : null, truncated };
    }

    /**
     * Stream one object, honouring Range. Returns a `Response` on success (200
     * whole object / 206 partial / 416 unsatisfiable), or `null` when the key is
     * unsafe, cross-tenant or missing — the route maps `null` to 404. No R2 bytes
     * are read for a refused key.
     */
    async open(tenantId: string, key: string, rangeHeader?: string): Promise<Response | null> {
        // The key is ALWAYS relative to the tenant prefix (that is what `list`
        // returns). We unconditionally prepend the verified tenant prefix, so a
        // caller smuggling another tenant's full key merely addresses a
        // nonexistent object under its own prefix — it can never read across
        // tenants. keyProblem rejects traversal/absolute/backslash/control
        // keys before any R2 call.
        const relativeKey = key;
        if (!usableRelativeKey(relativeKey)) return null;

        const fullKey = `${tenantId}/${relativeKey}`;
        const head = await this.bucket.head(fullKey);
        if (!head) return null;

        const size = head.size;
        const range = resolveByteRange(rangeHeader, size);
        const base: Record<string, string> = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ETag: head.etag ?? '' };

        if (range === 'unsatisfiable') {
            return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
        }
        if (range) {
            const length = range.end - range.start + 1;
            const obj = await this.bucket.get(fullKey, { range: { offset: range.start, length } });
            if (!obj) return null;
            return new Response(obj.body, {
                status: 206,
                headers: {
                    ...base,
                    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
                    'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
                    'Content-Length': String(length),
                },
            });
        }
        const obj = await this.bucket.get(fullKey);
        if (!obj) return null;
        return new Response(obj.body, {
            status: 200,
            headers: {
                ...base,
                'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
                'Content-Length': String(obj.size),
            },
        });
    }
}
