/**
 * What a finalized R2 video may point at, through the REAL app.
 *
 * `finalize` stores the poster key the client echoes back, and the poster route and the video delete both act on
 * the STORED key against a bucket every company shares. So the key must be the one the server derives for this
 * company, inspection and clip, and the clip key must belong to the inspection in the path. Every refusal is paired
 * with a positive control on the same harness.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { r2Keys } from '../../../server/lib/r2-keys';
import {
    createUploadHarness, filePart, jsonPost, INSPECTION_ID, OTHER_TENANT_ID, OTHER_TENANT_INSPECTION_ID, TENANT_ID, type UploadHarness,
} from '../helpers/native-upload-harness';

const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
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
