/**
 * A tenant purge must not leave unfinished chunked video uploads billing in the object store.
 *
 * The purge deletes the ledger rows with every other tenant table, and the objects by key prefix, but an
 * unfinished multipart upload is neither: it has no object yet. The purge therefore reads the ledger
 * BEFORE deleting it and aborts each unfinished upload it finds. Controls: a finished upload, and another
 * company's unfinished one, are not aborted; an abort that fails does not stop the purge.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantPurgeService } from '../../../server/services/tenant-purge.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';

function makeR2(failAbortFor?: string) {
    const aborted: string[] = [];
    const bucket = {
        list: vi.fn(async () => ({ objects: [], truncated: false, cursor: undefined })),
        delete: vi.fn(async () => {}),
        resumeMultipartUpload: vi.fn((key: string, uploadId: string) => ({
            abort: async () => {
                if (uploadId === failAbortFor) throw new Error('storage is down');
                aborted.push(`${key}#${uploadId}`);
            },
        })),
    } as unknown as R2Bucket;
    return { bucket, aborted };
}
const kv = { delete: vi.fn(async () => {}), list: vi.fn(async () => ({ keys: [], list_complete: true })) } as unknown as KVNamespace;

describe('tenant purge: unfinished chunked video uploads', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        for (const [id, slug] of [[TENANT, 'acme'], [OTHER, 'other']] as const) {
            await db.insert(schema.tenants).values({ id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        }
    });

    const seed = (tenantId: string, media: string, state: schema.VideoUpload['state'], uploadId: string | null) =>
        db.insert(schema.videoUploads).values({
            id: `${tenantId}-${media}`, tenantId, inspectionId: 'i1', mediaId: media, userId: 'u1', uploadId,
            r2Key: uploadId ? `${tenantId}/inspections/i1/video-${media}.mp4` : null, totalBytes: 10, partBytes: 8, partCount: 1,
            state, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
        });

    it('aborts the unfinished uploads of the purged company, and only those', async () => {
        await seed(TENANT, 'open', 'open', 'up-open');
        await seed(TENANT, 'busy', 'completing', 'up-busy');
        await seed(TENANT, 'done', 'completed', 'up-done');
        await seed(TENANT, 'bare', 'open', null);
        await seed(OTHER, 'theirs', 'open', 'up-theirs');
        const { bucket, aborted } = makeR2();
        await new TenantPurgeService({} as D1Database, bucket, kv).purge(TENANT);
        expect(aborted.sort()).toEqual([
            `${TENANT}/inspections/i1/video-busy.mp4#up-busy`,
            `${TENANT}/inspections/i1/video-open.mp4#up-open`,
        ]);
        expect(await db.select().from(schema.videoUploads).where(eq(schema.videoUploads.tenantId, TENANT)).all()).toHaveLength(0);
        expect(await db.select().from(schema.videoUploads).where(eq(schema.videoUploads.tenantId, OTHER)).all()).toHaveLength(1);
    });

    it('carries on with the purge when an abort fails', async () => {
        await seed(TENANT, 'a', 'open', 'up-a');
        await seed(TENANT, 'b', 'open', 'up-b');
        const { bucket, aborted } = makeR2('up-a');
        await new TenantPurgeService({} as D1Database, bucket, kv).purge(TENANT);
        expect(aborted).toEqual([`${TENANT}/inspections/i1/video-b.mp4#up-b`]);
        expect(await db.select().from(schema.videoUploads).where(eq(schema.videoUploads.tenantId, TENANT)).all()).toHaveLength(0);
        expect(await db.select().from(schema.tenants).where(eq(schema.tenants.id, TENANT)).all()).toHaveLength(0);
    });
});
