import { r2Delete, r2Get, r2Put } from '../../lib/r2/objects';
import { r2Keys } from '../../lib/r2-keys';

/**
 * What an intake source file can be.
 *
 * Two values, because two things reach the adapter layer: a vendor export
 * (JSON) and a spreadsheet the browser already flattened into CSV text.
 */
export type SourceExt = 'csv' | 'json';

/**
 * The extension the STORED object gets, derived from the uploaded file's name.
 *
 * Anything that is not JSON is stored as CSV, because that is what actually
 * arrives: the wizard turns a spreadsheet into CSV text in the browser rather
 * than parsing one inside a request, so an `.xlsx` upload carries CSV bytes by
 * the time it gets here. The extension describes the CONTENT.
 */
export function extForFileName(fileName: string): SourceExt {
    return fileName.trim().toLowerCase().endsWith('.json') ? 'json' : 'csv';
}

/**
 * Reading and writing the file an intake run was created from.
 *
 * The only place in the intake path that touches object storage, and it goes
 * through the shared helpers rather than the binding, so metering and key
 * policy stay in one place.
 *
 * There is no "read as bytes": every consumer wants text, and an adapter that
 * cannot take text is an adapter this format does not have.
 */
export class MigrationSourceFileService {
    constructor(private bucket: R2Bucket) {}

    /** Stores the source text and returns the key — the caller records it on the batch. */
    async put(tenantId: string, batchId: string, ext: SourceExt, text: string): Promise<string> {
        const key = r2Keys.migrationSource(tenantId, batchId, ext);
        await r2Put(this.bucket, key, text, {
            httpMetadata: { contentType: ext === 'json' ? 'application/json' : 'text/csv' },
        });
        return key;
    }

    /**
     * The stored text, or null when there is nothing there.
     *
     * Null rather than a throw: an expired or already-swept object is a normal
     * thing for a re-map to find, and the sentence the operator needs ("this
     * import's file is no longer stored") is the caller's to write.
     */
    async readText(key: string): Promise<string | null> {
        const object = await r2Get(this.bucket, key);
        if (!object) return null;
        return object.text();
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
