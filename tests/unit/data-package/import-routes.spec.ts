/**
 * Data-package import route tests: plan is read-only, preflight is read-only and
 * audited, apply is owner+token+step-up gated and audited. No row is written by
 * plan/preflight; apply writes only through the apply engine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import { d1For } from '../helpers/d1-binding';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import adminDataPackageRoutes from '../../../server/api/admin/admin-data-package';
import adminDataPackageImportRoutes from '../../../server/api/admin/data-package-import.routes';
import { tenants, auditLogs } from '../../../server/lib/db/schema';
import { tenantDataJobs } from '../../../server/lib/db/schema/data-package';
import { signJobToken } from '../../../server/lib/data-package/job-token';
import { schemaFingerprint } from '../../../server/lib/data-package/fingerprint';
import { issueStepUpToken } from '../../../server/lib/auth/step-up';
import { contacts } from '../../../server/lib/db/schema';

const TENANT = 't-import';
const USER = 'u-import';
const JOB = 'job-import';
const SECRET = 'import-route-secret';

describe('data-package import routes', () => {
    let db: any;
    let dbD1: ReturnType<typeof d1For>;
    let kv: any;
    let token: string;
    let fp: string;

    function app() {
        const a = new OpenAPIHono<HonoConfig>();
        a.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal', message: String(err) } }, 500));
        a.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('user', { sub: USER, role: 'owner' } as never);
            c.set('userRole', 'owner' as never);
            await next();
        });
        a.route('/api/admin', adminDataPackageRoutes);
        a.route('/api/admin', adminDataPackageImportRoutes);
        return a;
    }
    const env = () => ({ DB: dbD1, JWT_SECRET: SECRET, TENANT_CACHE: kv, APP_MODE: 'standalone' } as never);
    const call = (path: string, init?: RequestInit) => app().request(`/api/admin${path}`, init, env());
    const json = (body: unknown, headers: Record<string, string> = {}) => ({
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Data-Job': token, ...headers },
        body: JSON.stringify(body),
    });

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        dbD1 = d1For(setup.db);
        const store = new Map<string, string>();
        kv = {
            get: async (k: string) => store.get(k) ?? null,
            put: async (k: string, v: string) => { store.set(k, v); },
            delete: async (k: string) => { store.delete(k); },
        } as never;
        fp = await schemaFingerprint();
        await db.insert(tenants).values({ id: TENANT, slug: 'imp', createdAt: new Date(1_700_000_000_000), contentVersion: 'none' });
        await db.insert(tenantDataJobs).values({
            id: JOB, tenantId: TENANT, kind: 'import', status: 'running', stage: 'apply',
            createdBy: USER, createdAt: new Date(1_700_000_000_000), updatedAt: new Date(1_700_000_000_000),
            packageId: 'pkg-imp',
        } as never);
        token = await signJobToken({ tenantId: TENANT, jobId: JOB, userId: USER }, SECRET);
    });

    const preflightBody = () => ({
        formatVersion: 1, columnFingerprint: fp, schemaVersion: '0013_import_id_map',
        sourceTenantId: TENANT, sourceMode: 'standalone' as const, counts: { contacts: 2 },
    });

    it('returns the import plan (read-only)', async () => {
        const r = await call(`/data-package/jobs/${JOB}/import/plan`, { headers: { 'X-Data-Job': token } });
        expect(r.status).toBe(200);
        const body = await r.json() as any;
        expect(body.data.tiers[0]).toContain('tenants');
        expect(body.data.tiers.flat()).toContain('inspections');
    });

    it('preflights and audits data.import.preview without writing rows', async () => {
        const r = await call(`/data-package/jobs/${JOB}/import/preflight`, json(preflightBody()));
        expect(r.status).toBe(200);
        const body = await r.json() as any;
        expect(body.data.ok).toBe(true);
        expect(await db.select().from(contacts).all()).toHaveLength(0); // no rows written
        const rows = await db.select().from(auditLogs).all();
        expect(rows.some((x: any) => x.action === 'data.import.preview')).toBe(true);
    });

    it('applies a batch with step-up and audits data.import.apply', async () => {
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const body = {
            table: 'contacts', rows: [{ id: 'c-1', tenant_id: 'FORGED', name: 'A', email: 'a@x.test', created_at: 1_700_000_000_000 }],
        };
        const noStep = await call(`/data-package/jobs/${JOB}/import/batches`, json(body));
        expect(noStep.status).toBe(403); // step-up required
        const r = await call(`/data-package/jobs/${JOB}/import/batches`, json(body, { 'X-Step-Up-Token': stepUp }));
        expect(r.status).toBe(200);
        const result = await r.json() as any;
        expect(result.data.created.contacts).toBe(1);
        const rows = await db.select().from(contacts).all();
        expect(rows[0]!.tenantId).toBe(TENANT); // forged value ignored
        const audits = await db.select().from(auditLogs).all();
        expect(audits.some((x: any) => x.action === 'data.import.apply')).toBe(true);
    });

    it('refuses all three without a job token', async () => {
        const base = { headers: { 'content-type': 'application/json' }, method: 'POST' };
        const s1 = (await call(`/data-package/jobs/${JOB}/import/preflight`, { ...base, body: JSON.stringify(preflightBody()) })).status;
        const s2 = (await call(`/data-package/jobs/${JOB}/import/batches`, { ...base, body: JSON.stringify({ table: 'contacts', rows: [] }) })).status;
        const s3 = (await call(`/data-package/jobs/${JOB}/import/plan`)).status;
        // No X-Data-Job header: the route's required-header validation (and the
        // step-up guard on apply) rejects each one before the handler runs.
        expect(s1).toBeGreaterThanOrEqual(400);
        expect(s2).toBeGreaterThanOrEqual(400);
        expect(s3).toBeGreaterThanOrEqual(400);
    });
});
