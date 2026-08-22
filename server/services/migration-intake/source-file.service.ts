import { r2Delete, r2Get, r2Put } from '../../lib/r2/objects';
import { r2Keys } from '../../lib/r2-keys';

/**
 * What an intake source file can be.
 *
 * Three values, not two. `bin` exists because every real vendor export we have
 * measured is binary: a Spectora template export is XLSX, a Home Inspector Pro
 * template is a zip, and a HomeGauge form links a PDF. Storing those as text
 * does not merely fail to parse them — it destroys them, because a UTF-8 decode
 * of arbitrary bytes is not reversible.
 */
export type SourceExt = 'csv' | 'json' | 'bin';

/** Binary container formats vendors actually export. Lower-cased before matching. */
const BINARY_SUFFIXES = ['.xls', '.xlsx', '.tpz', '.tpx', '.tpzx', '.hgf', '.zip', '.pdf'];

/**
 * The extension the STORED object gets, derived from the uploaded file's name.
 *
 * The name is the only signal available at this point: nothing has parsed the
 * file yet. Anything not recognised as JSON or as a binary container is stored
 * as CSV, which is what a spreadsheet exported to text looks like.
 */
export function extForFileName(fileName: string): SourceExt {
    const name = fileName.trim().toLowerCase();
    if (name.endsWith('.json')) return 'json';
    if (BINARY_SUFFIXES.some((s) => name.endsWith(s))) return 'bin';
    return 'csv';
}

const CONTENT_TYPE: Record<SourceExt, string> = {
    json: 'application/json',
    csv: 'text/csv',
    bin: 'application/octet-stream',
};

/**
 * Reading and writing the file an intake run was created from.
 *
 * The only place in the intake path that touches object storage, and it goes
 * through the shared helpers rather than the binding, so metering and key
 * policy stay in one place.
 *
 * ── Bytes, not text ─────────────────────────────────────────────────────────
 * This module stores and returns BYTES. `readText` remains, because two callers
 * genuinely want text, but it is a decode over `readBytes` rather than a
 * separate path — so there is no way to store a file that only text can read
 * back.
 */
export class MigrationSourceFileService {
    constructor(private bucket: R2Bucket) {}

    /** Stores the source bytes and returns the key — the caller records it on the batch. */
    async put(tenantId: string, batchId: string, ext: SourceExt, bytes: Uint8Array): Promise<string> {
        const key = r2Keys.migrationSource(tenantId, batchId, ext);
        await r2Put(this.bucket, key, bytes, {
            httpMetadata: { contentType: CONTENT_TYPE[ext] },
        });
        return key;
    }

    /**
     * The stored bytes, or null when there is nothing there.
     *
     * Null rather than a throw: an expired or already-swept object is a normal
     * thing for a re-map to find, and the sentence the operator needs ("this
     * import's file is no longer stored") is the caller's to write.
     */
    async readBytes(key: string): Promise<Uint8Array | null> {
        const object = await r2Get(this.bucket, key);
        if (!object) return null;
        return new Uint8Array(await object.arrayBuffer());
    }

    /** The stored file decoded as UTF-8, for callers that want text. Null when absent. */
    async readText(key: string): Promise<string | null> {
        const bytes = await this.readBytes(key);
        if (bytes === null) return null;
        return new TextDecoder().decode(bytes);
    }

    /**
     * Deletes the given keys. An empty list is a no-op that issues no call —
     * `delete([])` on a bucket is a request that can fail for no reason.
     */
    async remove(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await r2Delete(this.bucket, keys);
    }
}
