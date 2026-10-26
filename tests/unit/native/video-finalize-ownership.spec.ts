/**
 * What a finalized R2 video may point at, through the REAL app.
 *
 * `finalize` stores the poster key the client echoes back, and the poster route and the video delete both act on
 * the STORED key against a bucket every company shares. So the key must be the one the server derives for this
 * company, inspection and clip, and the clip key must belong to the inspection in the path. Every refusal is paired
 * with a positive control on the same harness.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { JPEG_BYTES, MP4_BYTES } from '../helpers/media-bytes';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { r2Keys } from '../../../server/lib/r2-keys';
import {
    createUploadHarness, filePart, jsonPost, INSPECTION_ID, INSPECTOR_ID, OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, TENANT_ID, type UploadHarness,
} from '../helpers/native-upload-harness';

const MP4 = MP4_BYTES;
const JPEG = JPEG_BYTES;
const SECRET = new Uint8Array([83, 69, 67, 82, 69, 84]);
const FINALIZE = `/api/inspections/${INSPECTION_ID}/media/video/finalize`;
const SECOND_INSPECTION_ID = '44444444-0000-4000-8000-000000000002';

interface Ticket { mediaId: string; token: string; clipKey: string }

describe('finalizing an R2 video (real app)', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });

    /** The harness bucket plus a `get`, so a served poster can be read back. */
    function readableEnv(h: UploadHarness): Record<string, unknown> {
        const readable = {
            ...(h.r2.bucket as unknown as Record<string, unknown>),
            get: async (key: string) => {
                const hit = h.r2.store.get(key);
                if (!hit) return null;
                return {
                    body: new Blob([new Uint8Array(hit.bytes)]).stream(),
                    size: hit.bytes.length,
                    httpMetadata: { contentType: hit.contentType },
                };
            },
        };
        return { PHOTOS: readable };
    }

    async function setup(): Promise<UploadHarness> {
        u = await createUploadHarness();
        await u.h.db.insert(schema.inspections).values({
            id: SECOND_INSPECTION_ID, tenantId: TENANT_ID, propertyAddress: '8 Upload Road', status: 'requested', date: '2026-06-01', createdAt: new Date(),
        } as typeof schema.inspections.$inferInsert);
        return u;
    }

    /** Mints an upload slot, uploads the clip and returns what the client holds afterwards. */
    async function uploadedClip(h: UploadHarness): Promise<Ticket> {
        const created = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/create-upload`, jsonPost({}), { env: readableEnv(h) });
        expect(created.status, await created.clone().text()).toBe(200);
        const { uploadURL, ref } = ((await created.json()) as { data: { uploadURL: string; ref: { mediaId: string } } }).data;
        const token = new URL(uploadURL, 'http://x').searchParams.get('token') ?? '';
        const up = await h.call(`/api/public/uploads/video?token=${token}`, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null, env: readableEnv(h) });
        expect(up.status, await up.clone().text()).toBe(200);
        return { mediaId: ref.mediaId, token, clipKey: r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, ref.mediaId, 'mp4') };
    }

    async function storedPoster(h: UploadHarness, t: Ticket): Promise<string> {
        const res = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/r2-upload-poster?token=${t.token}`, { method: 'POST', body: filePart('image/jpeg', JPEG) }, { env: readableEnv(h) });
        expect(res.status, await res.clone().text()).toBe(200);
        return ((await res.json()) as { data: { posterKey: string } }).data.posterKey;
    }

    const finalize = (h: UploadHarness, body: Record<string, unknown>) => h.call(FINALIZE, jsonPost({ provider: 'r2', ...body }), { env: readableEnv(h) });
    const poolRows = (h: UploadHarness) => h.h.db.select().from(schema.inspectionMediaPool).where(eq(schema.inspectionMediaPool.tenantId, TENANT_ID)).all();

    it('keeps the poster the server derived: finalize, serve it, then delete the video and the poster goes with it (positive control)', async () => {
        const h = await setup();
        const t = await uploadedClip(h);
        const posterKey = await storedPoster(h, t);
        expect(posterKey).toBe(r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, t.mediaId));
        const done = await finalize(h, { mediaId: t.mediaId, r2Key: t.clipKey, posterKey });
        expect(done.status, await done.clone().text()).toBe(200);
        const { poolId } = ((await done.json()) as { data: { poolId: string } }).data;
        const served = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/r2-object/${poolId}/poster`, {}, { env: readableEnv(h) });
        expect(served.status).toBe(200);
        expect(served.headers.get('x-content-type-options')).toBe('nosniff');
        expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
        const gone = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${poolId}`, { method: 'DELETE' }, { env: readableEnv(h) });
        expect(gone.status, await gone.clone().text()).toBe(200);
        expect(h.r2.store.has(posterKey)).toBe(false);
        expect(h.r2.store.has(t.clipKey)).toBe(false);
    });

    it('refuses a poster key that points into another company, and neither serves nor deletes that object', async () => {
        const h = await setup();
        const t = await uploadedClip(h);
        const foreign = r2Keys.inspectionVideoPoster(OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, 'victim-media');
        h.r2.store.set(foreign, { bytes: SECRET, contentType: 'image/jpeg' });
        const refused = await finalize(h, { mediaId: t.mediaId, r2Key: t.clipKey, posterKey: foreign });
        expect(refused.status).toBe(400);
        expect(await poolRows(h)).toHaveLength(0);
        // Without a poster the same clip finalizes, the poster route has nothing to serve, and deleting it leaves the object alone.
        const done = await finalize(h, { mediaId: t.mediaId, r2Key: t.clipKey });
        expect(done.status, await done.clone().text()).toBe(200);
        const { poolId } = ((await done.json()) as { data: { poolId: string } }).data;
        const served = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/r2-object/${poolId}/poster`, {}, { env: readableEnv(h) });
        expect(served.status).toBe(404);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${poolId}`, { method: 'DELETE' }, { env: readableEnv(h) })).status).toBe(200);
        expect(h.r2.store.get(foreign)?.bytes).toEqual(SECRET);
    });

    it('refuses a poster key that is not the one derived for this clip, even inside the same inspection', async () => {
        const h = await setup();
        const t = await uploadedClip(h);
        const sameCompanyOtherInspection = r2Keys.inspectionVideoPoster(TENANT_ID, SECOND_INSPECTION_ID, t.mediaId);
        const sameInspectionOtherClip = r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, 'some-other-clip');
        for (const posterKey of [sameCompanyOtherInspection, sameInspectionOtherClip, '../escape.poster.jpg']) {
            const res = await finalize(h, { mediaId: t.mediaId, r2Key: t.clipKey, posterKey });
            expect(res.status, posterKey).toBe(400);
        }
        expect(await poolRows(h)).toHaveLength(0);
        // Control: the derived key is accepted.
        const ok = await finalize(h, { mediaId: t.mediaId, r2Key: t.clipKey, posterKey: r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, t.mediaId) });
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('takes the inspection from the path: a clip key of another inspection is refused', async () => {
        const h = await setup();
        const t = await uploadedClip(h);
        const elsewhere = r2Keys.inspectionVideo(TENANT_ID, SECOND_INSPECTION_ID, t.mediaId, 'mp4');
        h.r2.store.set(elsewhere, { bytes: MP4, contentType: 'video/mp4' });
        const refused = await finalize(h, { mediaId: t.mediaId, r2Key: elsewhere });
        expect(refused.status).toBe(404);
        expect(await poolRows(h)).toHaveLength(0);
        // The other company's clip key is refused the same way.
        const foreign = r2Keys.inspectionVideo(OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, t.mediaId, 'mp4');
        expect((await finalize(h, { mediaId: t.mediaId, r2Key: foreign })).status).toBe(404);
        expect(await poolRows(h)).toHaveLength(0);
        // Control: this inspection's own clip key finalizes, and the row belongs to this inspection.
        const ok = await finalize(h, { mediaId: t.mediaId, r2Key: t.clipKey });
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect((await poolRows(h))[0]?.inspectionId).toBe(INSPECTION_ID);
    });

    /** A stored clip with its pool row, optionally with a poster object, written straight into the harness. */
    async function seedClip(h: UploadHarness, inspectionId: string, mediaId: string, posterKey: string | null): Promise<{ poolId: string; clipKey: string }> {
        const clipKey = r2Keys.inspectionVideo(TENANT_ID, inspectionId, mediaId, 'mp4');
        h.r2.store.set(clipKey, { bytes: MP4, contentType: 'video/mp4' });
        if (posterKey) h.r2.store.set(posterKey, { bytes: JPEG, contentType: 'image/jpeg' });
        const poolId = `pool-${mediaId}`;
        await h.h.db.insert(schema.inspectionMediaPool).values({
            id: poolId, inspectionId, tenantId: TENANT_ID, provider: 'r2', r2Key: clipKey, posterKey, url: '', streamUid: null, uploadedAt: new Date(), mediaType: 'video',
        });
        return { poolId, clipKey };
    }
    const videoUrl = (inspectionId: string, poolId: string) => `/api/inspections/${inspectionId}/media/video/r2-object/${poolId}`;

    it('answers 404 for another inspection\'s video and poster by pool id and leaves it alone; the own inspection\'s are served and deleted (positive control)', async () => {
        const h = await setup();
        // This inspector is assigned to the first inspection only.
        await h.h.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, INSPECTOR_ID));
        await h.h.db.insert(schema.inspectionInspectors).values({ inspectionId: INSPECTION_ID, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: new Date() });
        const posterB = r2Keys.inspectionVideoPoster(TENANT_ID, SECOND_INSPECTION_ID, 'clip-b');
        const b = await seedClip(h, SECOND_INSPECTION_ID, 'clip-b', posterB);
        const posterA = r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, 'clip-a');
        const a = await seedClip(h, INSPECTION_ID, 'clip-a', posterA);
        const env = { env: readableEnv(h) };
        // The path names the inspection the caller may open; the pool id belongs to the other one.
        expect((await h.call(videoUrl(INSPECTION_ID, b.poolId), {}, env)).status).toBe(404);
        expect((await h.call(`${videoUrl(INSPECTION_ID, b.poolId)}/poster`, {}, env)).status).toBe(404);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${b.poolId}`, { method: 'DELETE' }, env)).status).toBe(404);
        expect(h.r2.store.has(b.clipKey)).toBe(true);
        expect(h.r2.store.has(posterB)).toBe(true);
        expect(await h.h.db.select().from(schema.inspectionMediaPool).where(eq(schema.inspectionMediaPool.id, b.poolId)).all()).toHaveLength(1);
        // Control: the same calls on the inspection's own video succeed.
        expect((await h.call(videoUrl(INSPECTION_ID, a.poolId), {}, env)).status).toBe(200);
        expect((await h.call(`${videoUrl(INSPECTION_ID, a.poolId)}/poster`, {}, env)).status).toBe(200);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${a.poolId}`, { method: 'DELETE' }, env)).status).toBe(200);
        expect(h.r2.store.has(a.clipKey)).toBe(false);
        expect(h.r2.store.has(posterA)).toBe(false);
    });

    it('does not serve or delete a stored poster key that is not the one derived for the row; a derived key is served and deleted (positive control)', async () => {
        const h = await setup();
        const foreignKeys = [
            r2Keys.inspectionVideoPoster(OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, 'victim-media'),
            r2Keys.inspectionVideoPoster(TENANT_ID, SECOND_INSPECTION_ID, 'clip-other'),
        ];
        const env = { env: readableEnv(h) };
        for (const [i, foreign] of foreignKeys.entries()) {
            const row = await seedClip(h, INSPECTION_ID, `clip-${i}`, foreign);
            h.r2.store.set(foreign, { bytes: SECRET, contentType: 'image/jpeg' });
            expect((await h.call(`${videoUrl(INSPECTION_ID, row.poolId)}/poster`, {}, env)).status, foreign).toBe(404);
            expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${row.poolId}`, { method: 'DELETE' }, env)).status).toBe(200);
            expect(h.r2.store.has(row.clipKey)).toBe(false);
            expect(h.r2.store.get(foreign)?.bytes, foreign).toEqual(SECRET);
        }
        const derived = r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, 'clip-own');
        const own = await seedClip(h, INSPECTION_ID, 'clip-own', derived);
        expect((await h.call(`${videoUrl(INSPECTION_ID, own.poolId)}/poster`, {}, env)).status).toBe(200);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${own.poolId}`, { method: 'DELETE' }, env)).status).toBe(200);
        expect(h.r2.store.has(derived)).toBe(false);
    });

    it('Stream: a restricted inspector cannot finalize, read or delete another inspection\'s video through a path they may open; their own works (positive control)', async () => {
        const h = await setup();
        await h.h.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, INSPECTOR_ID));
        await h.h.db.insert(schema.inspectionInspectors).values({ inspectionId: INSPECTION_ID, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: new Date() });
        await h.h.db.update(schema.tenantConfigs).set({ videoMode: 'stream', integrationConfig: JSON.stringify({ streamCustomerSubdomain: 'customer-abc' }) }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
        const stamped: Record<string, string> = { 'uid-a': INSPECTION_ID, 'uid-b': SECOND_INSPECTION_ID };
        const deleted: string[] = [];
        const STREAM = {
            video: (uid: string) => ({
                details: async () => ({ meta: { tenantId: TENANT_ID, inspectionId: stamped[uid] }, duration: 5, readyToStream: true, thumbnailTimestampPct: 0, status: {} }),
                delete: async () => { deleted.push(uid); },
            }),
        };
        const env = { env: { STREAM } };
        const finalizeStream = (streamUid: string) => h.call(FINALIZE, jsonPost({ provider: 'stream', streamUid }), env);
        const rows = () => h.h.db.select().from(schema.inspectionMediaPool).where(eq(schema.inspectionMediaPool.tenantId, TENANT_ID)).all();
        expect((await finalizeStream('uid-b')).status).toBe(404);
        expect(await rows()).toHaveLength(0);
        // Control: the video stamped with this inspection finalizes, then deletes.
        const ok = await finalizeStream('uid-a');
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await rows()).toHaveLength(1);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/uid-b`, { method: 'DELETE' }, env)).status).toBe(404);
        expect(deleted).toEqual([]);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/uid-a`, { method: 'DELETE' }, env)).status).toBe(200);
        expect(deleted).toEqual(['uid-a']);
        expect(await rows()).toHaveLength(0);
    });

    it('Stream: a restricted inspector cannot set the poster frame of another inspection\'s video; their own works (positive control)', async () => {
        const h = await setup();
        await h.h.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, INSPECTOR_ID));
        await h.h.db.insert(schema.inspectionInspectors).values({ inspectionId: INSPECTION_ID, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: new Date() });
        await h.h.db.update(schema.tenantConfigs).set({ videoMode: 'stream', integrationConfig: JSON.stringify({ streamCustomerSubdomain: 'customer-abc' }) }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
        const stamped: Record<string, string> = { 'uid-a': INSPECTION_ID, 'uid-b': SECOND_INSPECTION_ID };
        const frames: Record<string, number> = {};
        const STREAM = {
            video: (uid: string) => ({
                details: async () => ({ meta: { tenantId: TENANT_ID, inspectionId: stamped[uid] }, duration: 5, readyToStream: true, thumbnailTimestampPct: 0, status: {} }),
                update: async (p: { thumbnailTimestampPct: number }) => { frames[uid] = p.thumbnailTimestampPct; },
            }),
        };
        for (const [poolId, inspectionId, streamUid] of [['pool-a', INSPECTION_ID, 'uid-a'], ['pool-b', SECOND_INSPECTION_ID, 'uid-b']] as const) {
            await h.h.db.insert(schema.inspectionMediaPool).values({
                id: poolId, inspectionId, tenantId: TENANT_ID, provider: 'stream', r2Key: '', url: '', streamUid, uploadedAt: new Date(), mediaType: 'video',
            });
        }
        const setPoster = (streamUid: string) => h.call(`/api/inspections/${INSPECTION_ID}/media/video/poster`, jsonPost({ streamUid, posterPct: 0.5 }), { env: { STREAM } });
        const pct = async (id: string) => (await h.h.db.select().from(schema.inspectionMediaPool).where(eq(schema.inspectionMediaPool.id, id)).get())?.posterPct ?? null;
        expect((await setPoster('uid-b')).status).toBe(404);
        expect(frames).toEqual({});
        expect(await pct('pool-b')).toBeNull();
        // Control: the video of this inspection takes the frame.
        const ok = await setPoster('uid-a');
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(frames).toEqual({ 'uid-a': 0.5 });
        expect(await pct('pool-a')).toBe(0.5);
    });

    it('does not serve or delete an R2 clip key of another company or inspection, but still drops the row; an own clip key is served and deleted (positive control)', async () => {
        const h = await setup();
        const env = { env: readableEnv(h) };
        const foreignClips = [
            r2Keys.inspectionVideo(OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, 'victim-clip', 'mp4'),
            r2Keys.inspectionVideo(TENANT_ID, SECOND_INSPECTION_ID, 'other-clip', 'mp4'),
        ];
        for (const [i, foreign] of foreignClips.entries()) {
            h.r2.store.set(foreign, { bytes: SECRET, contentType: 'video/mp4' });
            const poolId = `pool-foreign-${i}`;
            await h.h.db.insert(schema.inspectionMediaPool).values({
                id: poolId, inspectionId: INSPECTION_ID, tenantId: TENANT_ID, provider: 'r2', r2Key: foreign, posterKey: null, url: '', streamUid: null, uploadedAt: new Date(), mediaType: 'video',
            });
            expect((await h.call(videoUrl(INSPECTION_ID, poolId), {}, env)).status, foreign).toBe(404);
            expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${poolId}`, { method: 'DELETE' }, env)).status).toBe(200);
            expect(h.r2.store.get(foreign)?.bytes, foreign).toEqual(SECRET);
            expect(await h.h.db.select().from(schema.inspectionMediaPool).where(eq(schema.inspectionMediaPool.id, poolId)).all()).toHaveLength(0);
        }
        const own = await seedClip(h, INSPECTION_ID, 'clip-own', null);
        const served = await h.call(videoUrl(INSPECTION_ID, own.poolId), {}, env);
        expect(served.status).toBe(200);
        expect(new Uint8Array(await served.arrayBuffer())).toEqual(MP4);
        expect((await h.call(`/api/inspections/${INSPECTION_ID}/media/video/${own.poolId}`, { method: 'DELETE' }, env)).status).toBe(200);
        expect(h.r2.store.has(own.clipKey)).toBe(false);
    });

    it('serves a stored poster only as jpeg, png or webp: a legacy svg object is answered as image/jpeg, a png as image/png (positive control)', async () => {
        const h = await setup();
        const env = { env: readableEnv(h) };
        const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
        for (const [mediaId, stored, served, bytes] of [['legacy', 'image/svg+xml', 'image/jpeg', SVG], ['modern', 'image/png', 'image/png', JPEG]] as const) {
            const posterKey = r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, mediaId);
            const row = await seedClip(h, INSPECTION_ID, mediaId, posterKey);
            h.r2.store.set(posterKey, { bytes: new Uint8Array(bytes), contentType: stored });
            const res = await h.call(`${videoUrl(INSPECTION_ID, row.poolId)}/poster`, {}, env);
            expect(res.status, mediaId).toBe(200);
            expect(res.headers.get('content-type'), mediaId).toBe(served);
            expect(new Uint8Array(await res.arrayBuffer()), mediaId).toEqual(new Uint8Array(bytes));
        }
    });

    it('stores a poster only for a clip that was uploaded under the token', async () => {
        const h = await setup();
        const created = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/create-upload`, jsonPost({}), { env: readableEnv(h) });
        const { uploadURL, ref } = ((await created.json()) as { data: { uploadURL: string; ref: { mediaId: string } } }).data;
        const token = new URL(uploadURL, 'http://x').searchParams.get('token') ?? '';
        const early = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, { method: 'POST', body: filePart('image/jpeg', JPEG) }, { env: readableEnv(h) });
        expect(early.status).toBe(404);
        expect(h.r2.store.size).toBe(0);
        // Control: once the clip is stored under that token, the same poster upload is accepted.
        const up = await h.call(`/api/public/uploads/video?token=${token}`, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null, env: readableEnv(h) });
        expect(up.status).toBe(200);
        const late = await h.call(`/api/inspections/${INSPECTION_ID}/media/video/r2-upload-poster?token=${token}`, { method: 'POST', body: filePart('image/jpeg', JPEG) }, { env: readableEnv(h) });
        expect(late.status, await late.clone().text()).toBe(200);
        expect(h.r2.store.has(r2Keys.inspectionVideoPoster(TENANT_ID, INSPECTION_ID, ref.mediaId))).toBe(true);
    });
});
