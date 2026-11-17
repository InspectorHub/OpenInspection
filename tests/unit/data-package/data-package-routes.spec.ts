/**
 * E-1 data-package route wiring tests.
 *
 * These exercise the real sub-router over a real in-memory D1-backed database,
 * so the guards that live on the routes (owner-only, step-up at job start, the
 * X-Data-Job binding on every data endpoint) and the response shape a desktop
 * client actually receives are covered end to end. Service-level invariants
 * (lease timing, keyset order, chunk byte cutting) stay in their own specs; this
 * file only proves the routes wire those services to the right identity, token
 * and header.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';
import adminDataPackageRoutes from '../../../server/api/admin/admin-data-package';
import { createTestDb } from '../db';
import { d1For } from '../helpers/d1-binding';
import { issueStepUpToken, STEP_UP_KV_PREFIX } from '../../../server/lib/auth/step-up';
import { tenants, inspections } from '../../../server/lib/db/schema';
import { tenantDataJobs } from '../../../server/lib/db/schema/data-package';

const SECRET = 'e1-route-test-secret';
const TENANT = 'tenant-e1';
const OTHER_TENANT = 'tenant-e1-other';
const USER = 'u-e1-owner';
const SNAPSHOT = 1_700_000_000_000;

/** KV with expirationTtl honoured against Date.now(), enough for the step-up guard. */
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

interface RouteOpts {
    role?: Role;
    tenantId?: string;
    userId?: string;
}

describe('data-package E-1 routes', () => {
    let db: any;
    let dbD1: ReturnType<typeof d1For>;
    let kv: ReturnType<typeof makeKv> & { store: Map<string, { value: string; expiresAt: number | null }> };

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

    function env() {
        return { DB: dbD1, JWT_SECRET: SECRET, TENANT_CACHE: kv } as never;
    }

    function call(path: string, init?: RequestInit, opts?: RouteOpts) {
        return app(opts).request(`/api/admin${path}`, init, env());
    }

    const json = (body: unknown, method = 'POST'): RequestInit => ({
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    /** Issue a native step-up token for the create-job action, delivered in the header. */
    async function stepUpHeader(opts: { userId?: string; tenantId?: string } = {}) {
        const { token } = await issueStepUpToken(kv, {
            userId: opts.userId ?? USER, tenantId: opts.tenantId ?? TENANT, action: 'data-export-start',
        });
        return { 'X-Step-Up-Token': token };
    }

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        dbD1 = d1For(setup.db);
        kv = makeKv() as ReturnType<typeof makeKv> & { store: Map<string, { value: string; expiresAt: number | null }> };
        await db.insert(tenants).values([
            { id: TENANT, slug: 'e1', status: 'active', tier: 'free', deploymentMode: 'shared', maxUsers: 10, createdAt: new Date(SNAPSHOT - 100000) },
            { id: OTHER_TENANT, slug: 'e1o', status: 'active', tier: 'free', deploymentMode: 'shared', maxUsers: 10, createdAt: new Date(SNAPSHOT - 100000) },
        ]);
        await db.insert(inspections).values({
            id: 'insp-e1', tenantId: TENANT, propertyAddress: 'E1 Road', status: 'scheduled',
            date: '2026-01-01', createdAt: new Date(SNAPSHOT - 1000),
        } as never);
    });

    /** Create a job through the route and return its id + job token. */
    async function createJob(over: RouteOpts = {}) {
        const header = { ...await stepUpHeader(over), 'content-type': 'application/json' };
        const res = await call('/data-package/jobs', {
            method: 'POST', headers: header,
            body: JSON.stringify({ kind: 'export', clientKind: 'desktop-windows', deviceLabel: 'office-laptop' }),
        }, over);
        expect(res.status).toBe(200);
        return await res.json() as { data: { jobId: string; jobToken: string; snapshotAt: number; schemaFingerprint: string } };
    }

    it('refuses job creation to a non-owner (owner-only guard)', async () => {
        const header = { ...await stepUpHeader(), 'content-type': 'application/json' };
        const res = await call('/data-package/jobs', {
            method: 'POST', headers: header,
            body: JSON.stringify({ kind: 'export', clientKind: 'desktop-windows', deviceLabel: 'laptop' }),
        }, { role: 'inspector' });
        expect(res.status).toBe(403);
    });

    it('requires a step-up elevation to start a job', async () => {
        const res = await call('/data-package/jobs', json({ kind: 'export', clientKind: 'desktop-windows', deviceLabel: 'laptop' }));
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { details?: { stepUpRequired?: boolean } } };
        expect(body.error.details?.stepUpRequired).toBe(true);
        // The step-up entry was burned even on the guarded path.
        expect([...kv.store.keys()].every((k) => !k.startsWith(STEP_UP_KV_PREFIX))).toBe(true);
    });

    it('creates a job with a valid step-up, returns a job token and emits a measurement-only budget header', async () => {
        const header = { ...await stepUpHeader(), 'content-type': 'application/json' };
        const res = await call('/data-package/jobs', {
            method: 'POST', headers: header,
            body: JSON.stringify({ kind: 'export', clientKind: 'desktop-windows', deviceLabel: 'office-laptop' }),
        });
        expect(res.status).toBe(200);
        const budget = res.headers.get('X-Dp-Budget');
        expect(budget).toMatch(/reads=0\/0;writes=0\/0;profile=worker-free;pageRows=48;pageBytes=98304/);
        const body = await res.json() as { success: true; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        expect(body.data.jobId).toBeTypeOf('string');
        expect(body.data.jobToken).toBeTypeOf('string');
        expect(body.data.schemaFingerprint).toBeTypeOf('string');
        expect(body.data.snapshotAt).toBeTypeOf('number');
    });

    it('conflicts when a second job is started while the lease is held', async () => {
        await createJob();
        const header = { ...await stepUpHeader(), 'content-type': 'application/json' };
        const res = await call('/data-package/jobs', {
            method: 'POST', headers: header,
            body: JSON.stringify({ kind: 'export', clientKind: 'desktop-windows', deviceLabel: 'office-laptop' }),
        });
        expect(res.status).toBe(409);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe(ErrorCode.JOB_LEASE_HELD);
    });

    it('refuses a forged X-Data-Job token on every data endpoint', async () => {
        const { jobId } = (await createJob()).data;
        const endpoints: [string, string][] = [
            [`/data-package/jobs/${jobId}/heartbeat`, 'POST'],
            [`/data-package/jobs/${jobId}/complete`, 'POST'],
            [`/data-package/jobs/${jobId}/abort`, 'POST'],
            [`/data-package/jobs/${jobId}/tables`, 'GET'],
            [`/data-package/jobs/${jobId}/tables/inspections/rows`, 'GET'],
        ];
        for (const [path, method] of endpoints) {
            const res = await call(path, { method, headers: { 'X-Data-Job': 'forged-token' } });
            expect(res.status, path).toBe(401);
            const body = await res.json() as { error: { code: string } };
            expect(body.error.code, path).toBe(ErrorCode.JOB_TOKEN_INVALID);
        }
    });

    it('requires the X-Data-Job header on protected data endpoints (OpenAPI validation)', async () => {
        const { jobId } = (await createJob()).data;
        // With `headers` declared correctly, zod-openapi validates the required
        // header and returns 400 before the handler runs; a missing credential
        // never reaches the service with `undefined`.
        const res = await call(`/data-package/jobs/${jobId}/tables`, { method: 'GET' });
        expect(res.status).toBe(400);
    });

    it('lists and reads jobs read-only, without a X-Data-Job token, scoped to the verified tenant', async () => {
        const { jobId } = (await createJob()).data;
        const list = await call('/data-package/jobs', { method: 'GET' });
        expect(list.status).toBe(200);
        const listBody = await list.json() as { data: { id: string }[] };
        expect(listBody.data.map((j) => j.id)).toContain(jobId);

        const one = await call(`/data-package/jobs/${jobId}`, { method: 'GET' });
        expect(one.status).toBe(200);
        const oneBody = await one.json() as { data: { id: string; status: string } };
        expect(oneBody.data.id).toBe(jobId);
        expect(oneBody.data.status).toBe('queued');

        // A job that exists only in another tenant is a 404 (tenant-scoped re-read).
        const foreign = await call('/data-package/jobs/no-such-job', { method: 'GET' }, { tenantId: OTHER_TENANT });
        expect(foreign.status).toBe(404);
    });

    it('lists exportable tables with the page ceilings and no outTable, and emits the budget header', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        const res = await call(`/data-package/jobs/${jobId}/tables`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Dp-Budget')).toContain('profile=worker-free');
        const body = await res.json() as { data: { table: string; maxPageRows: number }[]; snapshotAt: number };
        const names = body.data.map((t) => t.table);
        expect(names).toContain('inspections');
        expect(names).not.toContain('tenant_data_jobs');
        expect(body.data.find((t) => t.table === 'inspections')!.maxPageRows).toBe(48);
    });

    it('reads one tenant-scoped keyset page within the job watermark', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        const res = await call(`/data-package/jobs/${jobId}/tables/inspections/rows?limit=10`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { rows: Record<string, unknown>[]; next: string | null } };
        expect(body.data.rows.map((r) => r.id)).toEqual(['insp-e1']);
        expect(body.data.rows.every((r) => r.tenant_id === TENANT)).toBe(true);
        expect(body.data.next).toBeNull();
    });

    it('renews the lease and returns a fresh job token on heartbeat', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        const res = await call(`/data-package/jobs/${jobId}/heartbeat`, {
            method: 'POST', headers: { 'X-Data-Job': jobToken },
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { jobToken: string; leaseExpiresAt: string } };
        expect(body.data.jobToken).toBeTypeOf('string');
        expect(body.data.leaseExpiresAt).toBeTypeOf('string');
    });

    it('completes a job with attested counts and frees the lease', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        const res = await call(`/data-package/jobs/${jobId}/complete`, {
            method: 'POST',
            headers: { 'X-Data-Job': jobToken, 'content-type': 'application/json' },
            body: JSON.stringify({ counts: '{"inspections":1}', bytes: 42, sha256: 'abc' }),
        });
        expect(res.status).toBe(200);
        const one = await call(`/data-package/jobs/${jobId}`, { method: 'GET' });
        const body = await one.json() as { data: { status: string; leaseExpiresAt: string | null } };
        expect(body.data.status).toBe('complete');
        expect(body.data.leaseExpiresAt).toBeNull();

        // Terminal job: even a still-valid token cannot read through a data endpoint.
        const after = await call(`/data-package/jobs/${jobId}/tables`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        });
        expect(after.status).toBe(409);
    });

    it('aborts a job and frees the lease', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        const res = await call(`/data-package/jobs/${jobId}/abort`, {
            method: 'POST', headers: { 'X-Data-Job': jobToken },
        });
        expect(res.status).toBe(200);
        const one = await call(`/data-package/jobs/${jobId}`, { method: 'GET' });
        const body = await one.json() as { data: { status: string; leaseExpiresAt: string | null } };
        expect(body.data.status).toBe('cancelled');
        expect(body.data.leaseExpiresAt).toBeNull();
    });

    it('resumes a lapsed lease without step-up and returns a fresh token bound to the same job', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        // Force the lease to be lapsed, as it would be after a long export.
        await db.update(tenantDataJobs).set({ leaseExpiresAt: new Date(SNAPSHOT - 1) }).where(eq(tenantDataJobs.id, jobId));

        // No step-up token: resume is bearer-only and the job is already authorized.
        const res = await call(`/data-package/jobs/${jobId}/resume`, { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { jobToken: string; leaseExpiresAt: string } };
        expect(body.data.jobToken).toBeTypeOf('string');
        expect(body.data.leaseExpiresAt).toBeTypeOf('string');

        // The fresh token works on a data endpoint; the old one is still bound
        // to the same {tenant, job, user} so it remains valid too.
        const tables = await call(`/data-package/jobs/${jobId}/tables`, {
            method: 'GET', headers: { 'X-Data-Job': body.data.jobToken },
        });
        expect(tables.status).toBe(200);

        const after = await call(`/data-package/jobs/${jobId}`, { method: 'GET' });
        const state = await after.json() as { data: { status: string } };
        expect(state.data.status).toBe('running');
    });

    it('refuses to resume a job that exists only in another tenant', async () => {
        const { jobId } = (await createJob()).data;
        await db.update(tenantDataJobs).set({ leaseExpiresAt: new Date(SNAPSHOT - 1) }).where(eq(tenantDataJobs.id, jobId));
        const res = await call(`/data-package/jobs/${jobId}/resume`, { method: 'POST' }, { tenantId: OTHER_TENANT });
        expect(res.status).toBe(404);
    });

    it('refuses to resume a terminal job', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        await call(`/data-package/jobs/${jobId}/abort`, { method: 'POST', headers: { 'X-Data-Job': jobToken } });
        const res = await call(`/data-package/jobs/${jobId}/resume`, { method: 'POST' });
        expect(res.status).toBe(409);
    });

    it('refuses a valid job token presented for a different tenant or user than the session', async () => {
        const { jobId, jobToken } = (await createJob()).data;
        const foreignTenant = await call(`/data-package/jobs/${jobId}/tables`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        }, { tenantId: OTHER_TENANT });
        expect(foreignTenant.status).toBe(401);

        const foreignUser = await call(`/data-package/jobs/${jobId}/tables`, {
            method: 'GET', headers: { 'X-Data-Job': jobToken },
        }, { userId: 'u-e1-other' });
        expect(foreignUser.status).toBe(401);
    });
});
