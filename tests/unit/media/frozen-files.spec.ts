/**
 * A file a published version shows outlives every later edit of the working copy.
 *
 * The client's page and PDF are rendered from the frozen snapshot, so the stored files it names must not be
 * reaped by the orphan sweep, deleted from the media pool, or removed with a video. Each case is paired with
 * the same action on a file NO version names, so a guard that blocks everything cannot pass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const videoBackend = vi.hoisted(() => ({ delete: vi.fn(async () => undefined) }));
vi.mock('../../../server/services/video/resolve', () => ({
    resolveVideoBackend: async () => ({ backend: videoBackend, provider: 'r2' }),
}));
vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: () => undefined,
}));

import { sweepOrphanedMedia } from '../../../server/lib/media/sweep-orphans';
import { loadFrozenFileKeys } from '../../../server/lib/report-snapshot';
import mediaStudioRoutes from '../../../server/api/inspections/media-studio';

const TENANT = 't1';
const INSP = 'i1';
const NOW = Date.parse('2026-08-22T00:00:00.000Z');
const LONG_AGO = new Date(NOW - 30 * 24 * 60 * 60 * 1000);
const key = (name: string) => `${TENANT}/${INSP}/${name}`;

const FROZEN_DATA = {
    'sec:item': {
        photos: [{ key: key('original.jpg'), annotatedKey: key('annotated.jpg'), croppedKey: key('cropped.jpg') }],
        tabs: { defects: { d1: { photos: [{ key: key('defect.jpg') }] } } },
        customComments: { defects: [{ id: 'c1', photos: [{ key: key('custom.jpg') }] }] },
    },
    'sec:video': { photos: [{ key: key('clip.mp4'), mediaType: 'video', mediaId: 'vid-1', posterKey: key('poster.jpg') }] },
};

describe('files named by a published version', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        videoBackend.delete.mockClear();
        await db.insert(schema.tenants).values([{ id: TENANT, slug: 'acme', createdAt: new Date(NOW) }]);
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-08-20', createdAt: new Date(NOW),
        });
        // The working copy has since dropped every picture.
        await db.insert(schema.inspectionResults).values({
            id: 'r1', tenantId: TENANT, inspectionId: INSP, data: {}, lastSyncedAt: new Date(NOW),
        });
    });

    const freeze = (data: unknown, inspection: Record<string, unknown> = {}, snapshotJson?: string) =>
        db.insert(schema.reportVersions).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSP, versionNumber: 1, publishedAt: new Date(), publishedBy: 'u',
            snapshotJson: snapshotJson ?? JSON.stringify({ data, units: [], inspection }),
        });

    describe('loadFrozenFileKeys', () => {
        it('lists photos (original, annotated, cropped), defect and custom photos, videos, posters and the cover', async () => {
            await freeze(FROZEN_DATA, { coverImageKey: key('cover-crop.jpg'), coverPhotoId: key('cover.jpg') });
            const keys = await loadFrozenFileKeys(db as never, TENANT, INSP);
            for (const name of ['original.jpg', 'annotated.jpg', 'cropped.jpg', 'defect.jpg', 'custom.jpg', 'clip.mp4', 'poster.jpg', 'cover-crop.jpg', 'cover.jpg']) {
                expect(keys.has(key(name)), name).toBe(true);
            }
            expect(keys.has('vid-1')).toBe(true);
        });

        it("keeps the files of an earlier version too, and never reads another company's", async () => {
            await freeze({ a: { photos: [{ key: key('v1-only.jpg') }] } });
            await db.insert(schema.reportVersions).values({
                id: 'v2', tenantId: TENANT, inspectionId: INSP, versionNumber: 2, publishedAt: new Date(), publishedBy: 'u',
                snapshotJson: JSON.stringify({ data: { a: { photos: [{ key: key('v2.jpg') }] } }, units: [] }),
            });
            const keys = await loadFrozenFileKeys(db as never, TENANT, INSP);
            expect([...keys].sort()).toEqual([key('v1-only.jpg'), key('v2.jpg')].sort());
            expect((await loadFrozenFileKeys(db as never, 'other-company', INSP)).size).toBe(0);
        });
    });

    describe('the orphan sweep', () => {
        const sweep = async (objects: string[]) => {
            const r2 = {
                list: vi.fn(async (opts: { prefix?: string }) => ({
                    objects: opts.prefix === `${TENANT}/${INSP}/` ? objects.map((k) => ({ key: k })) : [], truncated: false, cursor: undefined,
                })),
                delete: vi.fn(async () => undefined),
            };
            // Every object has been unreferenced for longer than the grace period.
            await db.insert(schema.orphanedMedia).values(objects.map((k, n) => ({
                id: `o${n}`, tenantId: TENANT, inspectionId: INSP, r2Key: k, firstSeenAt: LONG_AGO,
            })));
            const result = await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, { limit: 5, afterInspectionId: null });
            return { r2, result };
        };

        it('does not reap a file only a published version shows, and still reaps one nothing shows', async () => {
            await freeze(FROZEN_DATA, { coverPhotoId: key('cover.jpg') });
            const frozen = [key('annotated.jpg'), key('poster.jpg'), key('cover.jpg')];
            const stray = key('stray.jpg');
            const { r2, result } = await sweep([...frozen, stray]);
            expect(r2.delete.mock.calls.map((c) => (c as unknown[])[0])).toEqual([stray]);
            expect(result.reaped).toBe(1);
        });

        it('reaps nothing of an inspection whose frozen files cannot be read', async () => {
            await freeze(null, {}, '{"data":{"broken"');
            // The malformed snapshot makes the read fail; the inspection is skipped, not swept on an incomplete list.
            const { r2 } = await sweep([key('stray.jpg')]);
            expect(r2.delete).not.toHaveBeenCalled();
        });
    });

    describe('deleting a video', () => {
        function app() {
            const a = new OpenAPIHono<HonoConfig>();
            a.onError((err, c) => (err instanceof AppError
                ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
                : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
            a.use('*', async (c, next) => {
                c.set('tenantId', TENANT);
                c.set('userRole', 'owner' as never);
                c.set('user', { sub: 'u' } as never);
                c.set('services', { inspection: { getInspection: async () => ({}) } } as never);
                await next();
            });
            a.route('/', mediaStudioRoutes);
            return a;
        }
        const poolVideo = (id: string, r2Key: string) => db.insert(schema.inspectionMediaPool).values({
            id, tenantId: TENANT, inspectionId: INSP, r2Key, url: `/x/${id}`, uploadedAt: new Date(), provider: 'r2',
        } as never);
        const remove = (id: string) => app().request(`/${INSP}/media/video/${id}`, { method: 'DELETE' }, { DB: {} });

        it('refuses a video a published version shows (409), and deletes one it does not', async () => {
            await freeze(FROZEN_DATA);
            await poolVideo('vid-1', key('clip.mp4'));
            await poolVideo('vid-2', key('draft-clip.mp4'));

            const refused = await remove('vid-1');
            expect(refused.status).toBe(409);
            expect(videoBackend.delete).not.toHaveBeenCalled();

            expect((await remove('vid-2')).status).toBe(200);
            expect(videoBackend.delete).toHaveBeenCalledTimes(1);
        });
    });
});
