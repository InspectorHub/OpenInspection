import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { streamZipToR2 } from '../../../server/lib/zip-to-r2';

/**
 * The multipart ZIP writer shared by the tenant offboarding export
 * (`DataExportService.buildZipToR2`) and the Privacy P3 subject SAR export.
 *
 * The properties worth pinning are the ones R2 rejects an upload over and that
 * a happy-path test would never notice: every part except the last is the SAME
 * size, and a failure mid-build aborts rather than leaving orphan parts behind.
 * Both used to live only in a workerd spec, where they could not be exercised
 * from the node suite that runs on every commit.
 */

interface Recorded { parts: Uint8Array[]; completed: boolean; aborted: boolean }

function fakeBucket(rec: Recorded, opts: { failOnPart?: number } = {}): R2Bucket {
    return {
        createMultipartUpload: async () => ({
            uploadPart: async (n: number, body: Uint8Array) => {
                if (opts.failOnPart === n) throw new Error('R2 part upload failed');
                rec.parts[n - 1] = body;
                return { partNumber: n, etag: `etag-${n}` };
            },
            complete: async () => { rec.completed = true; },
            abort: async () => { rec.aborted = true; },
        }),
    } as unknown as R2Bucket;
}

function streamOf(bytes: Uint8Array, chunk = 64 * 1024): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
        pull(c) {
            if (offset >= bytes.length) { c.close(); return; }
            c.enqueue(bytes.subarray(offset, offset + chunk));
            offset += chunk;
        },
    });
}

function joined(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

describe('streamZipToR2', () => {
    it('produces a readable archive from text and stream entries', async () => {
        const rec: Recorded = { parts: [], completed: false, aborted: false };
        const { parts } = await streamZipToR2(fakeBucket(rec), 'k.zip', async (w) => {
            await w.addText('README.txt', 'hello');
            await w.addStream('bin/a.dat', streamOf(new TextEncoder().encode('stream-bytes')));
        });
        expect(rec.completed).toBe(true);
        expect(parts).toBe(1); // small archive -> one short final part
        const files = unzipSync(joined(rec.parts));
        expect(strFromU8(files['README.txt']!)).toBe('hello');
        expect(strFromU8(files['bin/a.dat']!)).toBe('stream-bytes');
    });

    it('every part but the LAST is exactly the part size — R2 rejects anything else', async () => {
        const rec: Recorded = { parts: [], completed: false, aborted: false };
        // Incompressible-ish payload well over two 5 MiB parts, pushed through
        // the pass-through path so it is not deflated away to nothing.
        const big = new Uint8Array(13 * 1024 * 1024);
        for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) & 0xff;
        const { parts } = await streamZipToR2(fakeBucket(rec), 'k.zip', async (w) => {
            await w.addStream('big.bin', streamOf(big));
        }, { partSizeBytes: 1 }); // floor-clamped to 5 MiB
        const sizes = rec.parts.map((p) => p.length);
        // eslint-disable-next-line no-console
        console.log(`[zip-to-r2] ${parts} parts, sizes=${sizes.join(',')}`);
        expect(parts).toBeGreaterThan(1);
        const MIN = 5 * 1024 * 1024;
        for (const size of sizes.slice(0, -1)) expect(size).toBe(MIN);
        expect(sizes[sizes.length - 1]!).toBeLessThanOrEqual(MIN);
        const files = unzipSync(joined(rec.parts));
        expect(files['big.bin']!.length).toBe(big.length);
    });

    it('aborts the upload when the build throws — no orphan parts', async () => {
        const rec: Recorded = { parts: [], completed: false, aborted: false };
        await expect(streamZipToR2(fakeBucket(rec), 'k.zip', async (w) => {
            await w.addText('a.txt', 'a');
            throw new Error('assembler blew up');
        })).rejects.toThrow('assembler blew up');
        expect(rec.aborted).toBe(true);
        expect(rec.completed).toBe(false);
    });

    it('aborts when R2 itself rejects a part', async () => {
        const rec: Recorded = { parts: [], completed: false, aborted: false };
        const big = new Uint8Array(12 * 1024 * 1024).fill(7);
        await expect(streamZipToR2(fakeBucket(rec, { failOnPart: 1 }), 'k.zip', async (w) => {
            await w.addStream('big.bin', streamOf(big));
        })).rejects.toThrow('R2 part upload failed');
        expect(rec.aborted).toBe(true);
        expect(rec.completed).toBe(false);
    });
});
