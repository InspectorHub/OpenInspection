/**
 * The chunked video upload service against REAL (miniflare) R2 and a D1 built from the real migrations.
 *
 * The node-side spec drives the routes over a recording stub. This one proves what a stub can only
 * assume: that the binding hands back a handle that works from a later request (`resumeMultipartUpload`),
 * that a re-sent part replaces the earlier one, and that the error text of a stale part and of an
 * aborted upload is what the service classifies. It does NOT prove the real service's rules (the 5 MiB
 * minimum part size, a single-part upload, the exact error strings, ETag formats): the local runtime is
 * not authoritative for those, and they are checked by a smoke test against the deployed bucket.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { videoUploadParts, videoUploads } from '../../../server/lib/db/schema';
import { abort, complete, createOrResume, planPart, storePart, VIDEO_PART_BYTES, type UploadScope } from '../../../server/services/video/chunked-upload.service';
import { r2Keys } from '../../../server/lib/r2-keys';
import { applyMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const b = testEnv as unknown as { DB: D1Database; PHOTOS: R2Bucket };

const TENANT = 'chunk-tenant';
const INSPECTION = 'chunk-inspection';
const MP4_HEAD = [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x32];
const TWO = VIDEO_PART_BYTES + 100;

let seq = 0;
const scopeOf = (): UploadScope => ({
    tenantId: TENANT, inspectionId: INSPECTION, mediaId: `media-${++seq}-${crypto.randomUUID().slice(0, 6)}`,
    userId: 'chunk-user', exp: Math.floor(Date.now() / 1000) + 3600,
});
function part(size: number, withHead: boolean): Uint8Array {
    const out = new Uint8Array(size);
    if (withHead) out.set(MP4_HEAD);
    return out;
}
const db = () => drizzle(b.DB);

async function send(scope: UploadScope, n: number, bytes: Uint8Array) {
    const plan = await planPart(db(), scope, n);
    if (!plan.ok) return plan;
    return storePart(db(), b.PHOTOS, scope, plan.row, n, bytes);
}

beforeAll(async () => { await applyMigrations(b.DB, migrationSql); });

describe('chunked video upload on real R2', () => {
    it('joins parts sent by separate requests into one object with the sniffed type', async () => {
        const scope = scopeOf();
        expect((await createOrResume(db(), scope, TWO)).ok).toBe(true);
        expect((await send(scope, 1, part(VIDEO_PART_BYTES, true))).ok).toBe(true);
        expect((await send(scope, 2, part(100, false))).ok).toBe(true);
        const done = await complete(db(), b.PHOTOS, scope);
        expect(done.ok).toBe(true);
        const key = r2Keys.inspectionVideo(TENANT, INSPECTION, scope.mediaId, 'mp4');
        if (done.ok) expect(done.r2Key).toBe(key);
        const head = await b.PHOTOS.head(key);
        expect(head?.size).toBe(TWO);
        expect(head?.httpMetadata?.contentType).toBe('video/mp4');
        // Control: the object does not exist for a key that was never completed.
        expect(await b.PHOTOS.head(r2Keys.inspectionVideo(TENANT, INSPECTION, 'never-uploaded', 'mp4'))).toBeNull();
    });

    it('lets a re-sent part replace the first copy and still complete', async () => {
        const scope = scopeOf();
        await createOrResume(db(), scope, TWO);
        await send(scope, 1, part(VIDEO_PART_BYTES, true));
        await send(scope, 2, part(100, false));
        const resent = new Uint8Array(100).fill(7);
        expect((await send(scope, 2, resent)).ok).toBe(true);
        expect(await db().select().from(videoUploadParts).where(eq(videoUploadParts.mediaId, scope.mediaId)).all()).toHaveLength(2);
        expect((await complete(db(), b.PHOTOS, scope)).ok).toBe(true);
        const object = await b.PHOTOS.get(r2Keys.inspectionVideo(TENANT, INSPECTION, scope.mediaId, 'mp4'));
        const tail = new Uint8Array(await object!.arrayBuffer()).slice(VIDEO_PART_BYTES);
        expect(tail.every((v) => v === 7)).toBe(true);
    });

    it('classifies the real error for a part the ledger no longer matches, and starts the parts over', async () => {
        const scope = scopeOf();
        await createOrResume(db(), scope, TWO);
        await send(scope, 1, part(VIDEO_PART_BYTES, true));
        await send(scope, 2, part(100, false));
        await db().update(videoUploadParts).set({ etag: 'not-the-stored-etag' }).where(eq(videoUploadParts.mediaId, scope.mediaId));
        const res = await complete(db(), b.PHOTOS, scope);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.code).toBe('VIDEO_PARTS_MISMATCH');
        expect(await db().select().from(videoUploadParts).where(eq(videoUploadParts.mediaId, scope.mediaId)).all()).toHaveLength(0);
    });

    it('aborts in storage: the upload id no longer accepts parts, and nothing is left as an object', async () => {
        const scope = scopeOf();
        await createOrResume(db(), scope, TWO);
        await send(scope, 1, part(VIDEO_PART_BYTES, true));
        const row = (await db().select().from(videoUploads).where(eq(videoUploads.mediaId, scope.mediaId)).all())[0]!;
        expect((await abort(db(), b.PHOTOS, scope)).ok).toBe(true);
        await expect(b.PHOTOS.resumeMultipartUpload(row.r2Key!, row.uploadId!).uploadPart(1, part(VIDEO_PART_BYTES, true))).rejects.toThrow();
        expect(await b.PHOTOS.head(row.r2Key!)).toBeNull();
        // Control: a second upload that is not aborted still accepts parts on its own id.
        const live = scopeOf();
        await createOrResume(db(), live, TWO);
        expect((await send(live, 1, part(VIDEO_PART_BYTES, true))).ok).toBe(true);
    });

    it('records what the local runtime does with a single-part upload (not evidence about the real service)', async () => {
        const scope = scopeOf();
        await createOrResume(db(), scope, 64);
        expect((await send(scope, 1, part(64, true))).ok).toBe(true);
        const done = await complete(db(), b.PHOTOS, scope);
        expect(done.ok).toBe(true);
        expect((await b.PHOTOS.head(r2Keys.inspectionVideo(TENANT, INSPECTION, scope.mediaId, 'mp4')))?.size).toBe(64);
    });
});
