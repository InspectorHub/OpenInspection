/**
 * Chunked (multipart) video upload, through the REAL app over an in-memory D1 and a recording R2 stub:
 * opening, the whole upload, and the part size and number rules.
 *
 * Every refusal is paired with a control that proves the same request is accepted when it is
 * correct, so a refusal cannot come from the harness. The stub approximates storage's part-size rule
 * (equal parts, 5 MiB or more but the last); the real rule is checked by a smoke test after deploy.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { r2Keys } from '../../../server/lib/r2-keys';
import { MAX_VIDEO_BYTES } from '../../../server/lib/media/video-types';
import { MAX_OPEN_VIDEO_UPLOADS } from '../../../server/services/video/chunked-upload.service';
import { MOV_BYTES, MP4_BYTES, PNG_BYTES, WEBM_BYTES } from '../helpers/media-bytes';
import { INSPECTION_ID, TENANT_ID } from '../helpers/native-upload-harness';
import { BASE, PART, THREE, TWO, bytes, createChunkedKit } from '../helpers/video-chunked-kit';

describe('chunked video upload: opening, parts and sizes (real app)', () => {
    const kit = createChunkedKit();
    afterEach(() => kit.close());
    const { open, put, finish, cancel, json, code, sendAll, ledger, partRows, token } = kit;
    const u = { get r2() { return kit.u.r2; }, get h() { return kit.u.h; } };

    describe('opening', () => {
        it('fixes the part size and count, opens no storage upload yet, and answers a repeat with the same upload', async () => {
            const res = await open('m1', THREE);
            expect(res.status, await res.clone().text()).toBe(200);
            const data = (await json<{ data: Record<string, unknown> }>(res)).data;
            expect(data).toMatchObject({ state: 'open', mediaId: 'm1', totalBytes: THREE, partBytes: PART, partCount: 3, received: [] });
            expect(u.r2.uploads.size).toBe(0);
            const again = await open('m1', THREE);
            expect(again.status).toBe(200);
            expect((await u.h.db.select().from(schema.videoUploads).all())).toHaveLength(1);
        });

        it('refuses a repeat that names a different size, and a size over the limit or too small to be a video', async () => {
            await open('m1', THREE);
            const other = await open('m1', TWO);
            expect(other.status).toBe(409);
            expect(await code(other)).toBe('VIDEO_UPLOAD_PARAMS_MISMATCH');
            const big = await open('m2', MAX_VIDEO_BYTES + 1);
            expect(big.status).toBe(413);
            expect(await json(big)).toMatchObject({ code: 'VIDEO_TOO_LARGE', limits: { maxBytes: MAX_VIDEO_BYTES } });
            expect((await open('m3', 8)).status).toBe(400);
            // Controls: the same size is accepted again, and the largest allowed size opens with 25 parts.
            expect((await open('m1', THREE)).status).toBe(200);
            const largest = await open('m4', MAX_VIDEO_BYTES);
            expect((await json<{ data: { partCount: number } }>(largest)).data.partCount).toBe(25);
        });

        it('refuses a body that is not a positive integer size', async () => {
            const h = await kit.h();
            const url = `${BASE}?token=${await token('m1')}`;
            for (const body of ['{}', '{"totalBytes":"5"}', '{"totalBytes":1.5}', '{"totalBytes":0}', 'nope']) {
                const res = await h.call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, { auth: null });
                expect(res.status, body).toBe(400);
            }
            expect((await open('m1', TWO)).status).toBe(200);
        });

        it('limits how many uploads one member has open, and an aborted one stops counting', async () => {
            for (let i = 0; i < MAX_OPEN_VIDEO_UPLOADS; i += 1) expect((await open(`o${i}`, TWO)).status).toBe(200);
            const over = await open('over', TWO);
            expect(over.status).toBe(429);
            expect(await code(over)).toBe('VIDEO_TOO_MANY_OPEN');
            expect((await cancel('o0')).status).toBe(204);
            expect((await open('over', TWO)).status).toBe(200);
        });
    });

    describe('the whole upload', () => {
        it('stores the joined video under the key and type its own bytes decide, and repeats answer the same', async () => {
            await sendAll('m1', THREE);
            const done = await finish('m1');
            expect(done.status, await done.clone().text()).toBe(200);
            const key = r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, 'm1', 'mp4');
            expect((await json<{ data: unknown }>(done)).data).toEqual({ mediaId: 'm1', r2Key: key });
            expect(u.r2.store.get(key)?.bytes.length).toBe(THREE);
            expect(u.r2.store.get(key)?.contentType).toBe('video/mp4');
            expect((await ledger('m1'))?.state).toBe('completed');
            expect(await partRows('m1')).toHaveLength(0);

            // Idempotent: the same answer, and still one object.
            const again = await finish('m1');
            expect(again.status).toBe(200);
            expect((await json<{ data: unknown }>(again)).data).toEqual({ mediaId: 'm1', r2Key: key });
            // A replayed token cannot overwrite the finished object (control: part 1 was accepted before completion).
            const before = u.r2.store.get(key)?.bytes.slice(0, 20);
            const replay = await put('m1', 1, bytes(PART, WEBM_BYTES));
            expect(replay.status).toBe(409);
            expect(await code(replay)).toBe('VIDEO_ALREADY_COMPLETED');
            expect(u.r2.store.get(key)?.bytes.slice(0, 20)).toEqual(before);
            const reopened = await open('m1', THREE);
            expect((await json<{ data: { state: string; r2Key: string } }>(reopened)).data).toMatchObject({ state: 'completed', r2Key: key });
        });

        it('takes the key extension and stored type from the first bytes, whatever the client says', async () => {
            const cases: [Uint8Array<ArrayBuffer>, string, string][] = [
                [MP4_BYTES, 'mp4', 'video/mp4'], [MOV_BYTES, 'mov', 'video/quicktime'], [WEBM_BYTES, 'webm', 'video/webm'],
            ];
            for (const [head, ext, type] of cases) {
                const media = `t-${ext}`;
                await open(media, TWO);
                // The client labels every part video/webm; the label is never read.
                const h = await kit.h();
                const res = await h.call(`${BASE}/parts/1?token=${await token(media)}`, {
                    method: 'PUT', headers: { 'content-length': String(PART), 'content-type': 'video/webm' }, body: bytes(PART, head),
                }, { auth: null });
                expect(res.status, ext).toBe(200);
                const key = r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, media, ext);
                expect((await ledger(media))?.r2Key).toBe(key);
                expect((await ledger(media))?.contentType).toBe(type);
                expect([...u.r2.uploads.values()].find((m) => m.key === key)?.contentType).toBe(type);
            }
        });

        it('refuses a first part that is not a video, leaves nothing in storage and ends the upload', async () => {
            await open('bad', TWO);
            const res = await put('bad', 1, bytes(PART, PNG_BYTES));
            expect(res.status).toBe(400);
            expect(await code(res)).toBe('VIDEO_FORMAT_MISMATCH');
            expect(u.r2.uploads.size).toBe(0);
            expect(u.r2.store.size).toBe(0);
            expect(await partRows('bad')).toHaveLength(0);
            expect((await ledger('bad'))?.state).toBe('failed');
            expect((await open('bad', TWO)).status).toBe(410);
            // Control: a real video as part 1 of another upload is accepted.
            await open('good', TWO);
            expect((await put('good', 1, bytes(PART))).status).toBe(200);
        });

        it('accepts a single-part upload, and a re-sent part replaces the earlier one', async () => {
            await sendAll('solo', 64);
            expect((await finish('solo')).status).toBe(200);
            expect(u.r2.store.get(r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, 'solo', 'mp4'))?.bytes.length).toBe(64);

            await open('twice', TWO);
            await put('twice', 1, bytes(PART));
            expect((await put('twice', 2, bytes(100))).status).toBe(200);
            expect((await put('twice', 2, bytes(100))).status).toBe(200);
            expect(await partRows('twice')).toHaveLength(2);
            expect((await finish('twice')).status).toBe(200);
        });

        it('resumes with the part size the ledger recorded and the parts already received', async () => {
            await open('r', THREE);
            await put('r', 1, bytes(PART));
            await put('r', 2, bytes(PART, new Uint8Array(0)));
            const resumed = await json<{ data: { partBytes: number; partCount: number; received: { partNumber: number; size: number }[] } }>(await open('r', THREE));
            expect(resumed.data.partBytes).toBe(PART);
            expect(resumed.data.partCount).toBe(3);
            expect(resumed.data.received).toEqual([{ partNumber: 1, size: PART }, { partNumber: 2, size: PART }]);
            // The recorded size is the one in force even if the ledger is read after a restart of the service.
            expect((await ledger('r'))?.partBytes).toBe(PART);
        });
    });

    describe('part sizes and numbers', () => {
        it('accepts exactly the size each part must have and refuses any other, before storing anything', async () => {
            await open('s', THREE);
            const first = bytes(PART);
            // Larger than the part size, smaller than it, for a part that is not the last.
            for (const size of [PART + 1, PART - 1, 1]) {
                const res = await put('s', 1, bytes(size));
                expect(res.status, `part 1 as ${size}`).toBe(413);
                expect(await code(res)).toBe('VIDEO_PART_SIZE_MISMATCH');
            }
            expect(u.r2.uploads.size).toBe(0);
            expect((await put('s', 1, first)).status).toBe(200);
            // The last part is the remainder: a full-size last part is refused, the remainder is accepted.
            expect((await put('s', 2, bytes(PART))).status).toBe(200);
            const fullLast = await put('s', 3, bytes(PART));
            expect(fullLast.status).toBe(413);
            expect((await put('s', 3, bytes(99))).status).toBe(413);
            expect((await put('s', 3, bytes(100))).status).toBe(200);
            expect(u.r2.uploads.get('mpu-1')?.parts.size).toBe(3);
        });

        it('answers 404 for a part number outside 1..count, and 411 without a Content-Length', async () => {
            await open('n', TWO);
            await put('n', 1, bytes(PART));
            for (const n of [0, 3, 'abc', '1x', '-1', '999999']) {
                expect((await put('n', n, bytes(100))).status, String(n)).toBe(404);
            }
            const h = await kit.h();
            const noLength = await h.call(`${BASE}/parts/2?token=${await token('n')}`, {
                method: 'PUT', body: new ReadableStream<Uint8Array>({ start(ctl) { ctl.enqueue(bytes(100)); ctl.close(); } }), duplex: 'half',
            } as RequestInit, { auth: null });
            expect(noLength.status).toBe(411);
            expect((await put('n', 2, bytes(100))).status).toBe(200);
        });

        it('requires part 1 before any other part', async () => {
            await open('f', TWO);
            const early = await put('f', 2, bytes(100));
            expect(early.status).toBe(409);
            expect(await code(early)).toBe('VIDEO_FIRST_PART_REQUIRED');
            expect(u.r2.uploads.size).toBe(0);
            await put('f', 1, bytes(PART));
            expect((await put('f', 2, bytes(100))).status).toBe(200);
        });
    });

});
