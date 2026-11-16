/**
 * An in-memory `R2Bucket` that really holds bytes, for specs that copy objects.
 *
 * Unlike the upload harness's stub (whose `get` answers null), this one returns a readable body, keeps the
 * http metadata, lists by prefix and records every call, so a spec can prove what was read, written and removed.
 * `failPut` and `afterPuts` let a spec break the nth write to stand in for a storage failure.
 */
export interface StoredObject { bytes: Uint8Array; contentType: string; contentDisposition?: string }

export interface MemoryR2 {
    bucket: R2Bucket;
    store: Map<string, StoredObject>;
    /** Every call in order, `op:key` (a batch delete is one `delete:a,b` entry). */
    log: string[];
    /** Throws from `put` when this returns true for the destination key. */
    failPut: ((key: string) => boolean) | null;
    /** Stores one byte too few for this destination key, as a write that landed short would. */
    shortPut: ((key: string) => boolean) | null;
    keys(prefix?: string): string[];
    seed(key: string, bytes: Uint8Array | string, contentType?: string, contentDisposition?: string): void;
}

const toBytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

async function drain(body: ReadableStream | ArrayBuffer | Uint8Array | string | Blob | null): Promise<Uint8Array> {
    if (body === null) return new Uint8Array();
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return new Uint8Array(body);
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    return new Uint8Array(await new Response(body).arrayBuffer());
}

export function makeMemoryR2(): MemoryR2 {
    const store = new Map<string, StoredObject>();
    const log: string[] = [];
    const state: { failPut: ((key: string) => boolean) | null; shortPut: ((key: string) => boolean) | null } = { failPut: null, shortPut: null };
    const meta = (key: string, o: StoredObject) => ({ key, size: o.bytes.length, httpMetadata: { contentType: o.contentType, ...(o.contentDisposition ? { contentDisposition: o.contentDisposition } : {}) } });
    const bucket = {
        head: async (key: string) => { log.push(`head:${key}`); const o = store.get(key); return o ? meta(key, o) : null; },
        get: async (key: string) => {
            log.push(`get:${key}`);
            const o = store.get(key);
            if (!o) return null;
            return { ...meta(key, o), body: new Response(o.bytes.slice().buffer as ArrayBuffer).body, arrayBuffer: async () => o.bytes.slice().buffer };
        },
        put: async (key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string | Blob | null, opts?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }) => {
            log.push(`put:${key}`);
            if (state.failPut?.(key)) throw new Error(`storage unavailable for ${key}`);
            const full = await drain(body);
            const o = { bytes: state.shortPut?.(key) ? full.slice(0, -1) : full, contentType: opts?.httpMetadata?.contentType ?? '', ...(opts?.httpMetadata?.contentDisposition ? { contentDisposition: opts.httpMetadata.contentDisposition } : {}) };
            store.set(key, o);
            return meta(key, o);
        },
        delete: async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            log.push(`delete:${list.join(',')}`);
            for (const k of list) store.delete(k);
        },
        list: async (opts?: { prefix?: string; limit?: number }) => {
            log.push(`list:${opts?.prefix ?? ''}`);
            const objects = [...store.entries()].filter(([k]) => k.startsWith(opts?.prefix ?? '')).map(([k, o]) => meta(k, o));
            return { objects, truncated: false, cursor: undefined, delimitedPrefixes: [] };
        },
    };
    return {
        bucket: bucket as unknown as R2Bucket,
        store,
        log,
        get failPut() { return state.failPut; },
        set failPut(v) { state.failPut = v; },
        get shortPut() { return state.shortPut; },
        set shortPut(v) { state.shortPut = v; },
        keys: (prefix = '') => [...store.keys()].filter((k) => k.startsWith(prefix)).sort(),
        seed: (key, bytes, contentType = 'image/jpeg', contentDisposition) => { store.set(key, { bytes: toBytes(bytes), contentType, ...(contentDisposition ? { contentDisposition } : {}) }); },
    };
}
