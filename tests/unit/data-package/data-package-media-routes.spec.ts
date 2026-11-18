/**
 * E-2 data-package media route wiring tests.
 *
 * Exercises the real sub-router with an in-memory D1 + R2, so the guards that
 * live on the routes (owner-only, X-Data-Job binding, tenant re-scope) and the
 * binary Range response a desktop client actually receives are covered end to
 * end. Service invariants (cursor paging, traversal) stay in media.service.spec.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';
import adminDataPackageRoutes from '../../../server/api/admin/admin-data-package';
import { createTestDb } from '../db';
import { d1For } from '../helpers/d1-binding';
import { issueStepUpToken } from '../../../server/lib/auth/step-up';
import { tenants } from '../../../server/lib/db/schema';

const SECRET = 'e2-media-route-secret';
const TENANT = 'tenant-e2';
const USER = 'u-e2-owner';
const SNAPSHOT = 1_700_000_000_000;

function makeKv() {
    const store = new Map<string, { value: string; expiresAt: number | null }>();
    return {
        store,
        get: async (k: string) => {
            const e = store.get(k);
            if (!e) return null;
            if (e.expiresAt !== null && e.expiresAt <= Date.now()) { store.delete(k); return null; }
            return e.value;
        },
        put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
            store.set(k, { value: v, expiresAt: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null });
        },
        delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace;
}

function makeR2() {
    const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const meta = (key: string) => {
        const o = store.get(key)!;
        return { key, size: o.bytes.length, etag: `"e2-${key}"`, uploaded: new Date(SNAPSHOT), httpMetadata: { contentType: o.contentType } };
    };
    const bucket = {
        head: async (key: string) => store.has(key) ? meta(key) : null,
        get: async (key: string, opts?: { range?: { offset: number; length: number } }) => {
            const o = store.get(key);
            if (!o) return null;
            const bytes = opts?.range ? o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length) : o.bytes;
            return { ...meta(key), size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body };
        },
        list: async (opts?: { prefix?: string; limit?: number }) => ({
            objects: [...store.keys()].filter((k) => k.startsWith(opts?.prefix ?? '')).sort().map(meta),
            truncated: false, cursor: undefined, delimitedPrefixes: [],
        }),
    };
    return {
        bucket: bucket as unknown as R2Bucket,
        seed: (key: string, text: string, ct = 'image/jpeg') => {
            store.set(key, { bytes: new TextEncoder().encode(text), contentType: ct });
        },
    };
}

interface RouteOpts { role?: Role; tenantId?: string; userId?: string }

describe('data-package E-2 media routes', () => {
    let db: any;
    let dbD1: ReturnType<typeof d1For>;
    let kv: ReturnType<typeof makeKv>;
    let r2: ReturnType<typeof makeR2>;

    function app(opts: RouteOpts = {}) {
        const a = new OpenAPIHono<HonoConfig>();
        a.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status);
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        a.use('*', async (c, next) => {
            c.set('tenantId', opts.tenantId ?? TENANT);
            c.set('user', { sub: opts.userId ?? USER, role: (opts.role ?? 'owner') } as never);
            c.set('userRole', (opts.role ?? 'owner') as never);
            await next();
        });
        a.route('/api/admin', adminDataPackageRoutes);
        return a;
    }

    function call(path: string, init?: RequestInit, opts?: RouteOpts) {
        return app(opts).request(`/api/admin${path}`, init, {
            DB: dbD1, JWT_SECRET: SECRET, TENANT_CACHE: kv, PHOTOS: r2.bucket,
        } as never);
    }

    async function stepUpHeader() {
        const { token } = await issueStepUpToken(kv, { userId: USER, tenantId: TENANT, action: 'data-export-start' });
        return { 'X-Step-Up-Token': token };
    }

    async function createJob(): Promise<{ jobId: string; jobToken: string }> {
        const res = await call('/data-package/jobs', {
            method: 'POST',
            headers: { ...await stepUpHeader(), 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'export', clientKind: 'desktop-windows', deviceLabel: 'office-laptop' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { jobId: string; jobToken: string } };
        return body.data;
    }

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        dbD1 = d1For(setup.db);
        kv = makeKv();
        r2 = makeR2();
        await db.insert(tenants).values({
            id: TENANT, slug: 'e2', status: 'active', tier: 'free', deploymentMode: 'shared',
            maxUsers: 10, createdAt: new Date(SNAPSHOT - 100000),
        });
        r2.seed(`${TENANT}/inspections/i1/photos/a.jpg`, 'aaa', 'image/jpeg');
        r2.seed(`${TENANT}/exports/2026/backup.zip`, 'secret', 'application/zip');
        r2.seed(`${TENANT}/media/clip.mp4`, '0123456789', 'video/mp4');
    });

    it('refuses media endpoints without a X-Data-Job token (400) or with a forged one (401)', async () => {
        const { jobId } = await createJob();
        const missing = await call(`/data-package/jobs/${jobId}/media`, { method: 'GET' });
        expect(missing.status).toBe(400);
        const forged = await call(`/data-package/jobs/${jobId}/media`, {
            method: 'GET', headers: { 'X-Data-Job': 'forged' },
        });
        expect(forged.status).toBe(401);
        const forgedObj = await call(`/data-package/jobs/${jobId}/media/object?key=inspections/i1/photos/a.jpg`, {
            method: 'GET', headers: { 'X-Data-Job': 'forged' },
        });
        expect(forgedObj.status).toBe(401);
    });

    it('lists media under the tenant, excluding platform prefixes', async () => {
        const { jobId, jobToken } = await createJob();
        const res = await call(`/data-package/jobs/${jobId}/media`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { objects: { key: string }[] } };
        const keys = body.data.objects.map((o) => o.key);
        expect(keys).toContain('inspections/i1/photos/a.jpg');
        expect(keys).toContain('media/clip.mp4');
        expect(keys.some((k) => k.startsWith('exports/'))).toBe(false);
    });

    it('streams a full object and a ranged slice with the right headers', async () => {
        const { jobId, jobToken } = await createJob();
        const auth = { 'X-Data-Job': jobToken };

        const whole = await call(`/data-package/jobs/${jobId}/media/object?key=media/clip.mp4`, { method: 'GET', headers: auth });
        expect(whole.status).toBe(200);
        expect(whole.headers.get('Accept-Ranges')).toBe('bytes');
        expect(whole.headers.get('Cache-Control')).toBe('no-store');
        expect(await whole.text()).toBe('0123456789');

        const ranged = await call(`/data-package/jobs/${jobId}/media/object?key=media/clip.mp4`, {
            method: 'GET', headers: { ...auth, Range: 'bytes=2-5' },
        });
        expect(ranged.status).toBe(206);
        expect(ranged.headers.get('Content-Range')).toBe('bytes 2-5/10');
        expect(await ranged.text()).toBe('2345');

        const badRange = await call(`/data-package/jobs/${jobId}/media/object?key=media/clip.mp4`, {
            method: 'GET', headers: { ...auth, Range: 'bytes=999-' },
        });
        expect(badRange.status).toBe(416);
    });

    it('returns 404 for a missing or traversal key', async () => {
        const { jobId, jobToken } = await createJob();
        for (const key of ['media/missing.jpg', '../media/clip.mp4', 'exports/2026/backup.zip']) {
            const res = await call(`/data-package/jobs/${jobId}/media/object?key=${encodeURIComponent(key)}`, {
                method: 'GET', headers: { 'X-Data-Job': jobToken },
            });
            expect(res.status, key).toBe(404);
        }
    });

    it('refuses the media endpoints to a non-owner (owner-only guard)', async () => {
        const { jobId } = await createJob();
        const res = await call(`/data-package/jobs/${jobId}/media`, { method: 'GET' }, { role: 'inspector' });
        expect(res.status).toBe(403);
    });

    it('scope-checks the media endpoint by tenant (forged token from another tenant is 401)', async () => {
        const { jobId, jobToken } = await createJob();
        const res = await call(`/data-package/jobs/${jobId}/media`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        }, { tenantId: 'other-tenant' });
        expect(res.status).toBe(401);
    });
});
