/**
 * A chunked completion that did not finish cleanly: the Worker died after storage joined the object,
 * or the answer was lost. The row is then settled by looking at the object itself, never by guessing.
 * Each refusal has a control, and the "stuck" age is set directly on the ledger row.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { r2Keys } from '../../../server/lib/r2-keys';
import { logger } from '../../../server/lib/logger';
import { INSPECTION_ID, TENANT_ID } from '../helpers/native-upload-harness';
import { PART, TWO, bytes, createChunkedKit } from '../helpers/video-chunked-kit';

describe('chunked video upload: settling an unfinished completion (real app)', () => {
    const kit = createChunkedKit();
    afterEach(() => kit.close());
    const { put, finish, cancel, json, code, sendAll, ledger, partRows } = kit;
    const u = { get r2() { return kit.u.r2; }, get h() { return kit.u.h; } };

    const KEY = (media: string) => r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, media, 'mp4');
    const putObject = (media: string, size: number) => u.r2.store.set(KEY(media), { bytes: new Uint8Array(size), contentType: 'video/mp4' });
    const stick = (media: string, ageMs: number) => u.h.db.update(schema.videoUploads)
        .set({ state: 'completing', completingAt: new Date(Date.now() - ageMs) }).where(eq(schema.videoUploads.mediaId, media));

    it('settles a row stuck in completing past a minute by finding the object, and answers as a normal completion', async () => {
        await sendAll('s1', TWO);
        putObject('s1', TWO);
        await stick('s1', 120_000);
        const res = await finish('s1');
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await json<{ data: unknown }>(res)).data).toEqual({ mediaId: 's1', r2Key: KEY('s1') });
        expect((await ledger('s1'))?.state).toBe('completed');
        expect(await partRows('s1')).toHaveLength(0);
        expect(u.r2.store.size).toBe(1);
    });

    it('answers busy while a completing row is younger than a minute, even when the object is already there', async () => {
        await sendAll('s2', TWO);
        putObject('s2', TWO);
        await stick('s2', 5_000);
        const res = await finish('s2');
        expect(res.status).toBe(409);
        expect(await code(res)).toBe('VIDEO_UPLOAD_BUSY');
        expect((await ledger('s2'))?.state).toBe('completing');
    });

    it('finds the object when storage joined it but the answer was lost, whether the error is unknown or says the upload is gone', async () => {
        await sendAll('lost1', TWO);
        u.r2.throwAfterComplete = 'Network connection lost';
        const unknown = await finish('lost1');
        expect(unknown.status, await unknown.clone().text()).toBe(200);
        expect((await ledger('lost1'))?.state).toBe('completed');
        expect(u.r2.store.has(KEY('lost1'))).toBe(true);

        u.r2.throwAfterComplete = null;
        await sendAll('lost2', TWO);
        u.r2.uploads.get('mpu-2')!.state = 'aborted'; // the retry after a lost answer: storage says the upload is gone
        putObject('lost2', TWO);
        const gone = await finish('lost2');
        expect(gone.status).toBe(200);
        expect((await ledger('lost2'))?.state).toBe('completed');
    });

    it('fails the upload (410) when the object is not there and the storage upload is gone, and finishes it when the upload is still alive', async () => {
        await sendAll('x1', TWO);
        u.r2.uploads.get('mpu-1')!.state = 'aborted';
        await stick('x1', 120_000);
        const res = await finish('x1');
        expect(res.status).toBe(410);
        expect(await code(res)).toBe('VIDEO_UPLOAD_GONE');
        expect((await ledger('x1'))?.state).toBe('failed');
        expect(u.r2.store.size).toBe(0);
        // Control: a stuck row whose storage upload is still alive is completed by the retry.
        await sendAll('x2', TWO);
        await stick('x2', 120_000);
        expect((await finish('x2')).status).toBe(200);
        expect(u.r2.store.has(KEY('x2'))).toBe(true);
    });

    it('rethrows an unknown storage failure when the object is not there, logs it, stamps the start of the completion, and leaves the upload retryable', async () => {
        await sendAll('e1', TWO);
        const original = u.r2.bucket.resumeMultipartUpload.bind(u.r2.bucket);
        let stamped: unknown = null;
        Object.assign(u.r2.bucket, {
            resumeMultipartUpload: () => ({ complete: async () => { stamped = (await ledger('e1'))?.completingAt; throw new Error('storage exploded'); } }),
        });
        const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const res = await finish('e1');
        expect(res.status).toBe(500);
        expect(stamped).toBeInstanceOf(Date);
        const call = logged.mock.calls.find((c) => c[0] === 'video-chunked: completing failed');
        expect(call?.[1]).toMatchObject({ mediaId: 'e1', error: 'storage exploded' });
        expect(JSON.stringify(call?.[1])).not.toMatch(/token|secret/i);
        logged.mockRestore();
        expect((await ledger('e1'))?.state).toBe('open');
        Object.assign(u.r2.bucket, { resumeMultipartUpload: original });
        expect((await finish('e1')).status).toBe(200);
    });

    it('fails the upload, and leaves the object alone, when the object found while settling has another size', async () => {
        await sendAll('w1', TWO);
        putObject('w1', TWO + 5);
        await stick('w1', 120_000);
        const res = await finish('w1');
        expect(res.status).toBe(400);
        expect(await code(res)).toBe('VIDEO_SIZE_MISMATCH');
        // Not deleted: settling never removes an object it did not write.
        expect(u.r2.store.get(KEY('w1'))?.bytes.length).toBe(TWO + 5);
        expect((await ledger('w1'))?.state).toBe('failed');
        expect(await partRows('w1')).toHaveLength(0);
    });

    it('lets a cancel settle a stuck completing row: refused when the object exists, honoured when it does not, busy when young', async () => {
        await sendAll('k1', TWO);
        putObject('k1', TWO);
        await stick('k1', 120_000);
        const refused = await cancel('k1');
        expect(refused.status).toBe(409);
        expect(await code(refused)).toBe('VIDEO_ALREADY_COMPLETED');
        expect((await ledger('k1'))?.state).toBe('completed');
        expect(u.r2.store.has(KEY('k1'))).toBe(true);

        await sendAll('k2', TWO);
        await stick('k2', 120_000);
        expect((await cancel('k2')).status).toBe(204);
        expect((await ledger('k2'))?.state).toBe('aborted');
        expect(u.r2.uploads.get('mpu-2')?.state).toBe('aborted');

        await sendAll('k3', TWO);
        await stick('k3', 5_000);
        expect(await code(await cancel('k3'))).toBe('VIDEO_UPLOAD_BUSY');
        expect((await ledger('k3'))?.state).toBe('completing');
        // Control: a part sent to a stuck-then-completed upload is still refused.
        expect((await put('k1', 1, bytes(PART))).status).toBe(409);
    });
});
