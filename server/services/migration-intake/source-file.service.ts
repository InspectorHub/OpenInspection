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

/**
 * Names whose bytes are certainly not text. Lower-cased before matching.
 *
 * The test this list applies is NOT "can something here parse it". It is
 * narrower and it is the only one a name can answer: would decoding these bytes
 * as UTF-8 destroy them. A format nothing here reads still belongs on the list —
 * it is kept whole, filed as `bin`, and routed to the assisted path with its
 * bytes intact, which is the outcome the operator can still act on.
 *
 * A workbook has several dialects and they are all the same decision: `.xlsm`
 * and `.xlsb` are what Excel writes for a macro-enabled and a binary workbook,
 * `.ods` and `.numbers` are the two other office suites' packages. Every one of
 * them is a container. A name missing from here is not merely unrecognised — it
 * falls to `csv`, so the file is stored as `source.csv` stamped `text/csv` and
 * measured against the SMALLER cap, and the operator is told their spreadsheet
 * is too big for a file nowhere near the limit for its kind.
 *
 * `.xlsm` is on the list ON PURPOSE, macros and all. Nothing here executes a
 * workbook: the reader pulls one zip entry (`xl/worksheets/sheet1.xml`) and
 * parses XML, and `vbaProject.bin` is never opened. Refusing by name would also
 * refuse nothing real — the same bytes renamed `.xlsx` are accepted by every
 * check downstream, because those read the file's leading bytes rather than its
 * name — while turning away operators whose export merely carries the suffix.
 * Where a person opens one of these by hand, the staff-download route is the
 * boundary that governs it, and it already serves the bytes as
 * `application/octet-stream` under a name with no extension at all.
 */
const BINARY_SUFFIXES = [
    '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.numbers',
    '.tpz', '.tpx', '.tpzx', '.hgf', '.zip', '.pdf',
];

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
