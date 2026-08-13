/**
 * Stream a ZIP archive straight into an R2 object via multipart upload.
 *
 * Extracted from `DataExportService.buildZipToR2` when the Privacy P3 subject
 * SAR export needed the same machinery over a different row set. The two
 * exports differ ONLY in what goes into the archive; sharing the writer means
 * the part-sizing rules, the abort-on-failure path and the fflate error
 * plumbing have one implementation rather than two that drift.
 *
 * Why streaming at all: an in-memory build has to hold the whole archive, which
 * is what forced the old 64 MB photo budget and left large tenants with a
 * keys-only manifest. Here memory is bounded by ONE part buffer (~8 MiB) plus
 * the in-flight read chunk, so every photo can be embedded.
 *
 * R2 multipart contract, which the part buffer exists to satisfy: every part
 * except the LAST must be the SAME size, and non-last parts must be at least
 * 5 MiB. `takeExact` cuts precise PART_SIZE slices and only the final flush may
 * be short. On ANY failure the upload is aborted so no orphan parts survive.
 *
 * Idempotency is the CALLER's: re-running with the same `r2Key` overwrites the
 * same object, which is why both command paths have their key allocated by the
 * producer rather than minted per attempt.
 */
import { Zip, ZipPassThrough, ZipDeflate } from 'fflate';

/** The archive-building surface handed to the caller's `build` callback. */
export interface ZipEntryWriter {
    /**
     * Add an entry whose bytes come from a stream, WITHOUT recompressing them.
     * Photos and PDFs are already compressed; deflating them again costs CPU and
     * saves nothing. Flushes full parts as it reads, so a single huge object
     * never accumulates in memory.
     */
    addStream(name: string, body: ReadableStream<Uint8Array>): Promise<void>;
    /** Add a deflated text entry (CSV/JSON/README — these do compress). */
    addText(name: string, content: string): Promise<void>;
}

/** R2's floor for non-final parts. Not configurable — it is their rule, not ours. */
const MIN_PART_SIZE = 5 * 1024 * 1024;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

export async function streamZipToR2(
    bucket: R2Bucket,
    r2Key: string,
    build: (writer: ZipEntryWriter) => Promise<void>,
    opts: { /** Floor-clamped to R2's 5 MiB minimum part size. */ partSizeBytes?: number } = {},
): Promise<{ parts: number; bytes: number }> {
    const partSize = Math.max(opts.partSizeBytes ?? DEFAULT_PART_SIZE, MIN_PART_SIZE);
    const upload = await bucket.createMultipartUpload(r2Key);
    const parts: R2UploadedPart[] = [];
    let partNumber = 1;
    let totalBytes = 0;

    const pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let zipErr: Error | null = null;

    // fflate's Zip delivers output chunks SYNCHRONOUSLY during push()/end(),
    // so there is no completion callback to await — the contract is that once
    // end() returns, every byte the archive will ever produce is in `pending`.
    const zip = new Zip((err, chunk) => {
        if (err) { zipErr = err instanceof Error ? err : new Error(String(err)); return; }
        if (chunk && chunk.length > 0) { pending.push(chunk); pendingBytes += chunk.length; }
    });

    /** Concatenate exactly `n` bytes off the pending list (remainder kept). */
    const takeExact = (n: number): Uint8Array => {
        const out = new Uint8Array(n);
        let filled = 0;
        while (filled < n) {
            const head = pending[0]!;
            const need = n - filled;
            if (head.length <= need) {
                out.set(head, filled);
                filled += head.length;
                pending.shift();
            } else {
                out.set(head.subarray(0, need), filled);
                pending[0] = head.subarray(need);
                filled = n;
            }
        }
        pendingBytes -= n;
        totalBytes += n;
        return out;
    };

    const flushFullParts = async (): Promise<void> => {
        if (zipErr) throw zipErr;
        while (pendingBytes >= partSize) {
            parts.push(await upload.uploadPart(partNumber++, takeExact(partSize)));
        }
    };

    const writer: ZipEntryWriter = {
        async addStream(name, body) {
            const entry = new ZipPassThrough(name);
            zip.add(entry);
            const reader = body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                entry.push(value);
                await flushFullParts();
            }
            entry.push(new Uint8Array(0), true);
            await flushFullParts();
        },
        async addText(name, content) {
            const entry = new ZipDeflate(name);
            zip.add(entry);
            entry.push(new TextEncoder().encode(content), true);
            await flushFullParts();
        },
    };

    try {
        await build(writer);
        zip.end();
        await flushFullParts();
        // Final (possibly short) part. A zero-entry archive still emits the
        // end-of-central-directory record, so `pendingBytes` is never 0 here in
        // practice — the guard is for the degenerate case, not an optimisation.
        if (pendingBytes > 0) {
            parts.push(await upload.uploadPart(partNumber++, takeExact(pendingBytes)));
        }
        if (zipErr) throw zipErr;
        await upload.complete(parts);
        return { parts: parts.length, bytes: totalBytes };
    } catch (err) {
        await upload.abort().catch(() => { /* already gone */ });
        throw err;
    }
}
