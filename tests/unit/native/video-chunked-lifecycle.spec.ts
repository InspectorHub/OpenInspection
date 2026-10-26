/**
 * Chunked video upload, through the REAL app: completing, aborting and who may call.
 * Companion to video-chunked-upload.spec.ts; the calls come from the shared kit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { r2Keys } from '../../../server/lib/r2-keys';
import { signUploadToken } from '../../../server/lib/video-upload-token';
import { MAX_VIDEO_BYTES } from '../../../server/lib/media/video-types';
import { INSPECTION_ID, INSPECTOR_ID, OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, TENANT_ID } from '../helpers/native-upload-harness';
import { JWT_SECRET, PART, THREE, TWO, bytes, createChunkedKit } from '../helpers/video-chunked-kit';

describe('chunked video upload: completing, aborting, access (real app)', () => {
    const kit = createChunkedKit();
    afterEach(() => kit.close());
    const { open, put, finish, cancel, json, code, sendAll, ledger, partRows, token } = kit;
    const u = { get r2() { return kit.u.r2; }, get h() { return kit.u.h; } };

    describe('completing', () => {
        it('names the missing parts, and joins once they have all arrived', async () => {
            await open('c', THREE);
            await put('c', 1, bytes(PART));
            const missing = await finish('c');
            expect(missing.status).toBe(409);
            expect(await json(missing)).toMatchObject({ code: 'VIDEO_PARTS_MISSING', missing: [2, 3] });
            expect(u.r2.store.size).toBe(0);
            await put('c', 2, bytes(PART));
            await put('c', 3, bytes(100));
            expect((await finish('c')).status).toBe(200);
        });

        it('starts the parts over when storage no longer agrees with the ledger, and the upload then finishes', async () => {
            await open('x', TWO);
            await put('x', 1, bytes(PART));
            await put('x', 2, bytes(100));
            u.r2.uploads.get('mpu-1')!.parts.get(2)!.etag = 'replaced-elsewhere';
            const res = await finish('x');
            expect(res.status).toBe(409);
            expect(await code(res)).toBe('VIDEO_PARTS_MISMATCH');
            expect(await partRows('x')).toHaveLength(0);
            expect((await ledger('x'))?.state).toBe('open');
            expect((await json<{ data: { received: unknown[] } }>(await open('x', TWO))).data.received).toEqual([]);
            await put('x', 1, bytes(PART));
            await put('x', 2, bytes(100));
            expect((await finish('x')).status).toBe(200);
        });

        it('deletes the object and fails the upload when storage reports a size other than the declared one', async () => {
            await sendAll('z', TWO);
            u.r2.reportCompleteSize = TWO + 1;
            const res = await finish('z');
            expect(res.status).toBe(400);
            expect(await code(res)).toBe('VIDEO_SIZE_MISMATCH');
            expect(u.r2.store.size).toBe(0);
            expect((await ledger('z'))?.state).toBe('failed');
            // Control: with an honest report the same sequence completes.
            u.r2.reportCompleteSize = null;
            await sendAll('z2', TWO);
            expect((await finish('z2')).status).toBe(200);
        });

        it('checks the recorded total against the size limit and the declared size', async () => {
            await sendAll('big', TWO);
            await u.h.db.update(schema.videoUploadParts).set({ sizeBytes: MAX_VIDEO_BYTES + 1 })
                .where(and(eq(schema.videoUploadParts.mediaId, 'big'), eq(schema.videoUploadParts.partNumber, 2)));
            const over = await finish('big');
            expect(over.status).toBe(413);
            expect(await code(over)).toBe('VIDEO_TOO_LARGE');
            expect(u.r2.store.size).toBe(0);

            await sendAll('odd', TWO);
            await u.h.db.update(schema.videoUploadParts).set({ sizeBytes: 50 })
                .where(and(eq(schema.videoUploadParts.mediaId, 'odd'), eq(schema.videoUploadParts.partNumber, 2)));
            const odd = await finish('odd');
            expect(odd.status).toBe(409);
            expect(await code(odd)).toBe('VIDEO_PARTS_MISMATCH');
            expect(u.r2.store.size).toBe(0);
            // Control: an untouched upload completes.
            await sendAll('fine', TWO);
            expect((await finish('fine')).status).toBe(200);
        });

        it('lets only one completion run: an upload that is being completed answers busy', async () => {
            await sendAll('b', TWO);
            await u.h.db.update(schema.videoUploads).set({ state: 'completing', completingAt: new Date() }).where(eq(schema.videoUploads.mediaId, 'b'));
            const busy = await finish('b');
            expect(busy.status).toBe(409);
            expect(await code(busy)).toBe('VIDEO_UPLOAD_BUSY');
            expect(await code(await put('b', 1, bytes(PART)))).toBe('VIDEO_UPLOAD_BUSY');
            await u.h.db.update(schema.videoUploads).set({ state: 'open' }).where(eq(schema.videoUploads.mediaId, 'b'));
            expect((await finish('b')).status).toBe(200);
        });
    });

    describe('aborting', () => {
        it('ends an open upload in storage and the ledger, repeats cleanly, and refuses a later part', async () => {
            await open('a', TWO);
            await put('a', 1, bytes(PART));
            expect((await cancel('a')).status).toBe(204);
            expect(u.r2.uploads.get('mpu-1')?.state).toBe('aborted');
            expect(await partRows('a')).toHaveLength(0);
            expect((await ledger('a'))?.state).toBe('aborted');
            expect((await cancel('a')).status).toBe(204);
            expect((await put('a', 2, bytes(100))).status).toBe(410);
            expect((await open('a', TWO)).status).toBe(410);
        });

        it('cannot cancel a finished upload; a token with no upload answers 404 to a part or a completion and 204 to a cancel', async () => {
            await sendAll('d', TWO);
            await finish('d');
            expect((await cancel('d')).status).toBe(409);
            expect(u.r2.store.size).toBe(1);
            expect((await cancel('none')).status).toBe(204);
            for (const res of [await finish('none'), await put('none', 1, bytes(PART))]) {
                expect(res.status).toBe(404);
                expect(await code(res)).toBe('VIDEO_UPLOAD_NOT_FOUND');
            }
        });
    });

    describe('who may call', () => {
        it('never reads or changes another company\'s upload, and answers as if it did not exist', async () => {
            const now = new Date();
            await kit.h();
            await open('mine', TWO);
            await u.h.db.insert(schema.videoUploads).values({
                id: 'foreign-row', tenantId: OTHER_TENANT_ID, inspectionId: OTHER_TENANT_INSPECTION_ID, mediaId: 'shared-media-id',
                userId: 'someone', uploadId: 'mpu-foreign', r2Key: 'foreign/key.mp4', contentType: 'video/mp4',
                totalBytes: TWO, partBytes: PART, partCount: 2, state: 'open', createdAt: now, expiresAt: new Date(now.getTime() + 3600_000),
            });
            // Same media id, this company's token: no row of ours, so 404, identical to an id that exists nowhere.
            const clash = await put('shared-media-id', 1, bytes(PART));
            const nowhere = await put('nowhere-at-all', 1, bytes(PART));
            expect(clash.status).toBe(404);
            expect(await json(clash)).toEqual(await json(nowhere));
            expect((await finish('shared-media-id')).status).toBe(404);
            expect((await cancel('shared-media-id')).status).toBe(204);
            const foreign = (await u.h.db.select().from(schema.videoUploads).where(eq(schema.videoUploads.id, 'foreign-row')).all())[0];
            expect(foreign?.state).toBe('open');
            expect(u.r2.uploads.size).toBe(0);
            // Control: our own upload is reachable.
            expect((await put('mine', 1, bytes(PART))).status).toBe(200);
        });

        it('refuses a bad, expired, wrong-kind or issuerless token, and a removed member (401), with a control for each', async () => {
            const good = await token('m1');
            const at = good.length - 12;
            const tampered = good.slice(0, at) + (good[at] === 'A' ? 'B' : 'A') + good.slice(at + 1);
            const expired = await token('m1', {}, -1);
            const photo = await signUploadToken({ tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: 'm1', userId: INSPECTOR_ID, ext: 'jpeg' }, 600, JWT_SECRET, 'photo');
            const legacy = await signUploadToken({ tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: 'm1' }, 600, JWT_SECRET);
            const strangerToken = await token('m1', { userId: 'not-a-member' });
            for (const [label, tok] of [['tampered', tampered], ['expired', expired], ['photo', photo], ['legacy', legacy], ['stranger', strangerToken]] as const) {
                expect((await open('m1', TWO, tok)).status, label).toBe(401);
                expect((await put('m1', 1, bytes(PART), tok)).status, label).toBe(401);
                expect((await finish('m1', tok)).status, label).toBe(401);
                expect((await cancel('m1', tok)).status, label).toBe(401);
            }
            expect(await u.h.db.select().from(schema.videoUploads).all()).toHaveLength(0);
            expect((await open('m1', TWO, good)).status).toBe(200);
            await u.h.db.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, INSPECTOR_ID));
            expect((await put('m1', 1, bytes(PART), good)).status).toBe(401);
            expect(u.r2.uploads.size).toBe(0);
            await u.h.db.update(schema.users).set({ deletedAt: null }).where(eq(schema.users.id, INSPECTOR_ID));
            expect((await put('m1', 1, bytes(PART), good)).status).toBe(200);
        });

        it('answers 404 once native clients are switched off, and when the inspection is gone', async () => {
            expect((await open('m1', TWO, undefined, { NATIVE_CLIENT_ENABLED: 'false' })).status).toBe(404);
            expect(await u.h.db.select().from(schema.videoUploads).all()).toHaveLength(0);
            expect((await open('m1', TWO)).status).toBe(200);
            await sendAll('m2', TWO);
            await u.h.db.delete(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID));
            expect((await finish('m2')).status).toBe(404);
            expect((await open('m3', TWO)).status).toBe(404);
            expect(u.r2.store.size).toBe(0);
        });
    });
});
