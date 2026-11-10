/**
 * A stored video is managed by the backend that HOLDS it, not by the plan the tenant is on today.
 *
 * The plan only picks the backend for a NEW upload. A tenant whose paid plan ended (tier 'free') must still be
 * able to delete a video it uploaded to Stream, and a tenant that moved up must still be able to delete an
 * R2 video. Each case sits beside its opposite so a route that always answers one way cannot pass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/audit', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    auditFromContext: () => undefined,
}));

import mediaStudioRoutes from '../../../server/api/inspections/media-studio';

const TENANT = 't1';
const INSP = 'i1';

describe('video backend follows the stored row', () => {
    let db: BetterSQLite3Database<typeof schema>;
    const streamDelete = vi.fn(async () => undefined);
    const r2Delete = vi.fn(async () => undefined);
    const fakeStream = {
        video: (_uid: string) => ({
            details: async () => ({ meta: { tenantId: TENANT, inspectionId: INSP }, readyToStream: true, duration: 3, thumbnailTimestampPct: 0, status: {} }),
            delete: streamDelete,
        }),
        createDirectUpload: vi.fn(async () => ({ uploadURL: 'https://stream.example/up', id: 'new-uid' })),
    };
    const fakeR2 = { delete: r2Delete, head: async () => null };

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        streamDelete.mockClear();
        r2Delete.mockClear();
        fakeStream.createDirectUpload.mockClear();
    });

    const seedTenant = async (tier: 'free' | 'pro' | 'enterprise') => {
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', tier, status: 'active', createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main', date: '2026-08-20', createdAt: new Date(),
        });
    };
    const poolRow = (values: Record<string, unknown>) => db.insert(schema.inspectionMediaPool).values({
        tenantId: TENANT, inspectionId: INSP, url: '', uploadedAt: new Date(), mediaType: 'video', ...values,
    } as never);

    function app() {
        const a = new OpenAPIHono<HonoConfig>();
        a.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        a.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'owner' as never);
            c.set('user', { sub: 'u' } as never);
            c.set('profile', SAAS_PROFILE);
            c.set('services', { inspection: { getInspection: async () => ({}) } } as never);
            await next();
        });
        a.route('/', mediaStudioRoutes);
        return a;
    }
    const env = () => ({ DB: {}, STREAM: fakeStream, PHOTOS: fakeR2, JWT_SECRET: 'x'.repeat(48), STREAM_CUSTOMER_SUBDOMAIN: 'customer-x' });
    const remove = (ref: string) => app().request(`/${INSP}/media/video/${ref}`, { method: 'DELETE' }, env());

    it('deletes an old Stream video for a tenant now on the free plan', async () => {
        await seedTenant('free');
        await poolRow({ id: 'pool-s', provider: 'stream', streamUid: 'uid-1', r2Key: '' });

        const res = await remove('uid-1');
        expect(res.status).toBe(200);
        expect(streamDelete).toHaveBeenCalledTimes(1);
        const left = await db.select().from(schema.inspectionMediaPool).all();
        expect(left).toEqual([]);
    });

    it('deletes an old Stream video addressed by its POOL ROW id, using the stored Stream uid', async () => {
        await seedTenant('free');
        await poolRow({ id: 'pool-s', provider: 'stream', streamUid: 'uid-1', r2Key: '' });
        const seen: string[] = [];
        const original = fakeStream.video;
        fakeStream.video = (uid: string) => { seen.push(uid); return original(uid); };
        try {
            const res = await remove('pool-s');
            expect(res.status).toBe(200);
        } finally { fakeStream.video = original; }
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((u) => u === 'uid-1')).toBe(true);
        expect(streamDelete).toHaveBeenCalledTimes(1);
        expect(await db.select().from(schema.inspectionMediaPool).all()).toEqual([]);
    });

    it('refuses to delete a Stream video a published version shows, whichever id names it (409)', async () => {
        await seedTenant('free');
        await poolRow({ id: 'pool-s', provider: 'stream', streamUid: 'uid-1', r2Key: '' });
        await db.insert(schema.reportVersions).values({
            id: 'rv1', tenantId: TENANT, inspectionId: INSP, versionNumber: 1, publishedAt: new Date(), publishedBy: 'u',
            snapshotJson: JSON.stringify({ data: { s: { photos: [{ mediaType: 'video', provider: 'stream', streamUid: 'uid-1', mediaId: 'pool-s' }] } }, units: [], inspection: {} }),
        });
        expect((await remove('pool-s')).status).toBe(409);
        expect((await remove('uid-1')).status).toBe(409);
        expect(streamDelete).not.toHaveBeenCalled();
    });

    it('refuses a Stream video a published version names only by its Stream uid, when deleted by pool row id (409)', async () => {
        await seedTenant('free');
        await poolRow({ id: 'pool-s', provider: 'stream', streamUid: 'uid-1', r2Key: '' });
        await db.insert(schema.reportVersions).values({
            id: 'rv2', tenantId: TENANT, inspectionId: INSP, versionNumber: 1, publishedAt: new Date(), publishedBy: 'u',
            snapshotJson: JSON.stringify({ data: { s: { photos: [{ mediaType: 'video', provider: 'stream', streamUid: 'uid-1' }] } }, units: [], inspection: {} }),
        });
        expect((await remove('pool-s')).status).toBe(409);
        expect(streamDelete).not.toHaveBeenCalled();
    });

    it('deletes an R2 video for a tenant now on a paid plan', async () => {
        await seedTenant('pro');
        const key = `${TENANT}/inspections/${INSP}/videos/m1.mp4`;
        await poolRow({ id: 'm1', provider: 'r2', r2Key: key });

        const res = await remove('m1');
        expect(res.status).toBe(200);
        expect(streamDelete).not.toHaveBeenCalled();
        expect(r2Delete).toHaveBeenCalled();
    });

    it('still answers 404 for a video that has no stored row on the free plan (negative control)', async () => {
        await seedTenant('free');
        const res = await remove('uid-unknown');
        expect(res.status).toBe(404);
        expect(streamDelete).not.toHaveBeenCalled();
    });

    it('does not reach another inspection\'s or tenant\'s video (negative control)', async () => {
        await seedTenant('free');
        await db.insert(schema.inspections).values({
            id: 'i2', tenantId: TENANT, propertyAddress: '2 Main', date: '2026-08-21', createdAt: new Date(),
        });
        await db.insert(schema.inspectionMediaPool).values({
            id: 'other', tenantId: TENANT, inspectionId: 'i2', url: '', uploadedAt: new Date(), mediaType: 'video',
            provider: 'stream', streamUid: 'uid-other', r2Key: '',
        } as never);
        const res = await remove('uid-other');
        expect(res.status).toBe(404);
        expect(streamDelete).not.toHaveBeenCalled();
    });

    it('a NEW upload on the free plan goes to R2, and on a paid plan to Stream', async () => {
        await seedTenant('free');
        const post = () => app().request(`/${INSP}/media/video/create-upload`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        }, env());

        const free = await post();
        expect(free.status).toBe(200);
        const freeBody = await free.json() as { data: { provider: string } };
        expect(freeBody.data.provider).toBe('r2');
        expect(fakeStream.createDirectUpload).not.toHaveBeenCalled();

        await db.update(schema.tenants).set({ tier: 'pro' });
        const paid = await post();
        expect(paid.status).toBe(200);
        expect(((await paid.json()) as { data: { provider: string } }).data.provider).toBe('stream');
        expect(fakeStream.createDirectUpload).toHaveBeenCalledTimes(1);
    });

    it('finalizes an upload in the provider it was created with when the plan changes in between', async () => {
        await seedTenant('pro');
        const post = (path: string, body: unknown) => app().request(`/${INSP}/media/video/${path}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }, env());
        const created = await post('create-upload', {});
        const ref = ((await created.json()) as { data: { ref: { provider: string; streamUid: string } } }).data.ref;
        expect(ref.provider).toBe('stream');

        await db.update(schema.tenants).set({ tier: 'free' });
        const done = await post('finalize', ref);
        expect(done.status).toBe(200);
        const rows = await db.select().from(schema.inspectionMediaPool).all();
        expect(rows.map((r) => [r.provider, r.streamUid])).toEqual([['stream', ref.streamUid]]);
    });
});
