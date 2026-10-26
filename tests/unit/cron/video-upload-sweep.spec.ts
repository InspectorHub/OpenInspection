/**
 * The chunked video upload sweep, against the recording R2 stub and the real ledger tables.
 *
 * Rows are written directly so their age is exact; storage uploads are opened on the stub so "aborted"
 * is something the stub can say. Every claim about a row being touched has a control row, in the same
 * pass, that must NOT be: not yet expired, ended but inside its grace, or another company's live upload.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { videoUploadSweepJob } from '../../../server/cron/jobs/video-uploads';
import { CRON_JOBS } from '../../../server/cron/registry';
import { ENDED_ROW_GRACE_MS, hasDueVideoUploads, sweepVideoUploads } from '../../../server/services/video/chunked-upload-sweep';
import { createUploadHarness, INSPECTION_ID, OTHER_TENANT_ID, TENANT_ID, type UploadHarness } from '../helpers/native-upload-harness';

const NOW = new Date('2026-10-27T12:00:00Z');
const HOUR = 3_600_000;
type State = schema.VideoUpload['state'];

describe('video upload sweep', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });
    const kit = async () => {
        u ??= await createUploadHarness();
        const db = drizzle(u.h.env.DB);
        let n = 0;
        /** A ledger row, with a storage upload on the stub unless `bare`. */
        async function row(o: { media: string; state: State; expiresAt: Date; tenantId?: string; bare?: boolean; key?: string }) {
            const tenantId = o.tenantId ?? TENANT_ID;
            const r2Key = o.key ?? `${tenantId}/inspections/${INSPECTION_ID}/video-${o.media}.mp4`;
            const mpu = o.bare ? null : await u!.r2.bucket.createMultipartUpload(r2Key);
            await db.insert(schema.videoUploads).values({
                id: `row-${o.media}-${++n}`, tenantId, inspectionId: INSPECTION_ID, mediaId: o.media, userId: 'someone',
                uploadId: mpu?.uploadId ?? null, r2Key: mpu ? r2Key : null, contentType: mpu ? 'video/mp4' : null,
                totalBytes: 100, partBytes: 8 * 1024 * 1024, partCount: 1, state: o.state, createdAt: NOW, expiresAt: o.expiresAt,
            });
            await db.insert(schema.videoUploadParts).values({ tenantId, mediaId: o.media, partNumber: 1, etag: 'e', sizeBytes: 100, receivedAt: NOW });
            return { r2Key, uploadId: mpu?.uploadId ?? null };
        }
        const state = async (media: string, tenantId = TENANT_ID) => (await db.select().from(schema.videoUploads)
            .where(and(eq(schema.videoUploads.tenantId, tenantId), eq(schema.videoUploads.mediaId, media))).all())[0]?.state;
        const parts = async (media: string, tenantId = TENANT_ID) => (await db.select().from(schema.videoUploadParts)
            .where(and(eq(schema.videoUploadParts.tenantId, tenantId), eq(schema.videoUploadParts.mediaId, media))).all()).length;
        const mpuState = (id: string | null) => [...u!.r2.uploads.entries()].find(([k]) => k === id)?.[1].state;
        return { db, row, state, parts, mpuState, r2: u.r2 };
    }
    const past = (ms: number) => new Date(NOW.getTime() - ms);
    const future = (ms: number) => new Date(NOW.getTime() + ms);

    it('aborts the storage upload of an expired open upload and drops its parts, and leaves a live one and another company\'s live one alone', async () => {
        const k = await kit();
        const dead = await k.row({ media: 'dead', state: 'open', expiresAt: past(HOUR) });
        const live = await k.row({ media: 'live', state: 'open', expiresAt: future(HOUR) });
        const other = await k.row({ media: 'other', state: 'open', expiresAt: future(HOUR), tenantId: OTHER_TENANT_ID });
        const otherDead = await k.row({ media: 'other-dead', state: 'open', expiresAt: past(HOUR), tenantId: OTHER_TENANT_ID });
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(2);
        expect(await k.state('dead')).toBe('aborted');
        expect(k.mpuState(dead.uploadId)).toBe('aborted');
        expect(await k.parts('dead')).toBe(0);
        expect(await k.state('other-dead', OTHER_TENANT_ID)).toBe('aborted');
        expect(k.mpuState(otherDead.uploadId)).toBe('aborted');
        // Controls.
        expect(await k.state('live')).toBe('open');
        expect(k.mpuState(live.uploadId)).toBe('open');
        expect(await k.parts('live')).toBe(1);
        expect(await k.state('other', OTHER_TENANT_ID)).toBe('open');
        expect(k.mpuState(other.uploadId)).toBe('open');
    });

    it('settles an expired completing row by its object, and never deletes the object', async () => {
        const k = await kit();
        const done = await k.row({ media: 'done', state: 'completing', expiresAt: past(HOUR) });
        k.r2.store.set(done.r2Key, { bytes: new Uint8Array(100), contentType: 'video/mp4' });
        const none = await k.row({ media: 'none', state: 'completing', expiresAt: past(HOUR) });
        const wrong = await k.row({ media: 'wrong', state: 'completing', expiresAt: past(HOUR) });
        k.r2.store.set(wrong.r2Key, { bytes: new Uint8Array(7), contentType: 'video/mp4' });
        await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10);
        expect(await k.state('done')).toBe('completed');
        expect(k.r2.store.has(done.r2Key)).toBe(true);
        expect(k.mpuState(done.uploadId)).toBe('open'); // not aborted: its object exists
        expect(await k.state('none')).toBe('aborted');
        expect(k.mpuState(none.uploadId)).toBe('aborted');
        expect(await k.state('wrong')).toBe('failed');
        expect(k.r2.store.has(wrong.r2Key)).toBe(true);
        expect(await k.parts('done') + await k.parts('none') + await k.parts('wrong')).toBe(0);
    });

    it('deletes an ended row, and any parts left under it, once its grace has passed, and not before', async () => {
        const k = await kit();
        const old = past(ENDED_ROW_GRACE_MS + HOUR);
        const fresh = past(HOUR); // expired, but inside the grace
        const gone: [string, State][] = [['a', 'aborted'], ['f', 'failed'], ['c', 'completed']];
        for (const [media, state] of gone) await k.row({ media, state, expiresAt: old });
        const kept = await k.row({ media: 'kept', state: 'aborted', expiresAt: fresh });
        const completed = await k.row({ media: 'oldc', state: 'completed', expiresAt: old });
        k.r2.store.set(completed.r2Key, { bytes: new Uint8Array(100), contentType: 'video/mp4' });
        await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10);
        for (const [media] of gone) {
            expect(await k.state(media), media).toBeUndefined();
            expect(await k.parts(media), media).toBe(0);
        }
        expect(await k.state('oldc')).toBeUndefined();
        expect(k.r2.store.has(completed.r2Key)).toBe(true); // a finished video is never touched
        expect(await k.state('kept')).toBe('aborted');
        expect(await k.parts('kept')).toBe(1);
        expect(kept.uploadId).not.toBeNull();
    });

    it('handles at most the batch size per pass, oldest first, and the probe falls quiet once nothing is due', async () => {
        const k = await kit();
        for (let i = 0; i < 25; i += 1) await k.row({ media: `m${String(i).padStart(2, '0')}`, state: 'open', expiresAt: past(HOUR + i * 1000), bare: true });
        await k.row({ media: 'later', state: 'open', expiresAt: future(HOUR), bare: true });
        expect(await hasDueVideoUploads(k.db, NOW)).toBe(true);
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(10);
        const aborted = async () => (await k.db.select().from(schema.videoUploads).where(eq(schema.videoUploads.state, 'aborted')).all()).length;
        expect(await aborted()).toBe(10);
        // Oldest first: the 10 with the largest ages were taken.
        expect(await k.state('m24')).toBe('aborted');
        expect(await k.state('m00')).toBe('open');
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(10);
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(5);
        expect(await hasDueVideoUploads(k.db, NOW)).toBe(false);
        expect(await k.state('later')).toBe('open');
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(0);
    });

    it('keeps going when one row cannot be reaped, and tries it again on a later pass', async () => {
        const k = await kit();
        const bad = await k.row({ media: 'bad', state: 'completing', expiresAt: past(2 * HOUR) });
        await k.row({ media: 'good', state: 'open', expiresAt: past(HOUR) });
        const head = k.r2.bucket.head.bind(k.r2.bucket);
        Object.assign(k.r2.bucket, { head: async (key: string) => { if (key === bad.r2Key) throw new Error('head failed'); return head(key); } });
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(1);
        expect(await k.state('good')).toBe('aborted');
        expect(await k.state('bad')).toBe('completing');
        Object.assign(k.r2.bucket, { head });
        expect(await sweepVideoUploads(k.db, k.r2.bucket, NOW, 10)).toBe(1);
        expect(await k.state('bad')).toBe('aborted');
    });

    it('is a registered job on the five-minute tick, and does nothing without a bucket even when rows are due', async () => {
        const k = await kit();
        expect(CRON_JOBS.map((j) => j.key)).toContain('video-upload-sweep');
        await k.row({ media: 'x', state: 'open', expiresAt: new Date(Date.now() - 2 * HOUR), bare: true });
        const env = { DB: u!.h.env.DB, PHOTOS: k.r2.bucket };
        expect(await videoUploadSweepJob.probe(env)).toBe(1);
        expect(await videoUploadSweepJob.probe({ DB: u!.h.env.DB })).toBe(0);
        expect(await videoUploadSweepJob.run({ DB: u!.h.env.DB }, null)).toEqual({ processed: 0, nextCursor: null });
        expect(await k.state('x')).toBe('open');
        expect((await videoUploadSweepJob.run(env, null)).processed).toBe(1);
        expect(await k.state('x')).toBe('aborted');
    });
});
