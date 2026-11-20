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
import { tenantDataJobs, importIdMap } from '../../../server/lib/db/schema/data-package';
import { signJobToken } from '../../../server/lib/data-package/job-token';
import { schemaFingerprint } from '../../../server/lib/data-package/fingerprint';
import { issueStepUpToken } from '../../../server/lib/auth/step-up';
import { contacts } from '../../../server/lib/db/schema';
import { sha256Hex } from '../../../server/lib/sha256';

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
    const bucketObjects = new Map<string, Uint8Array>();
    const photosBucket = {
        delete: async (k: string) => { bucketObjects.delete(k); },
        put: async (k: string, bytes: ArrayBuffer | Uint8Array) => {
            bucketObjects.set(k, new Uint8Array(bytes as ArrayBuffer));
            return {};
        },
        get: async (k: string) => {
            const b = bucketObjects.get(k);
            return b ? { text: async () => new TextDecoder().decode(b) } : null;
        },
    } as never;
    const env = () => ({ DB: dbD1, JWT_SECRET: SECRET, TENANT_CACHE: kv, PHOTOS: photosBucket, APP_MODE: 'standalone' } as never);
    const call = (path: string, init?: RequestInit) => app().request(`/api/admin${path}`, init, env());
    const json = (body: unknown, headers: Record<string, string> = {}) => ({
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Data-Job': token, ...headers },
        body: JSON.stringify(body),
    });

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        dbD1 = d1For(setup.db);
        bucketObjects.clear();
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

    it('reverts one step with step-up and audits data.import.revert', async () => {
        // Seed a mapped row as if the apply engine wrote it.
        await db.insert(contacts).values({
            id: 'c-r', tenantId: TENANT, name: 'A', email: 'a@x.test', createdAt: new Date(1_700_000_000_000),
        } as never);
        await db.insert(importIdMap).values({
            id: 'map-r', tenantId: TENANT, packageId: 'pkg-imp', tableName: 'contacts',
            sourceId: 'c-r', newId: 'c-r', createdAt: new Date(1_700_000_000_000),
        } as never);
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-revert',
        });
        const noStep = await call(`/data-package/jobs/${JOB}/revert/step`, json({}, {
            'X-Step-Up-Token': 'bogus',
        }));
        expect(noStep.status).toBe(403); // bad step-up
        const r = await call(`/data-package/jobs/${JOB}/revert/step`, json({}, { 'X-Step-Up-Token': stepUp }));
        expect(r.status).toBe(200);
        const result = await r.json() as any;
        expect(result.data.done).toBe(true);
        expect(result.data.deleted.contacts).toBe(1);
        expect(await db.select().from(contacts).all()).toHaveLength(0);
        const audits = await db.select().from(auditLogs).all();
        expect(audits.some((x: any) => x.action === 'data.import.revert')).toBe(true);
    });

    it('lists archives and 404s a missing one (read-only viewer)', async () => {
        const list = await call(`/data-package/jobs/${JOB}/import/archives`, { headers: { 'X-Data-Job': token } });
        expect(list.status).toBe(200);
        expect((await list.json() as any).data.archives).toEqual([]);
        const detail = await call(`/data-package/jobs/${JOB}/import/archives/no-such`, { headers: { 'X-Data-Job': token } });
        expect(detail.status).toBe(404);
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

    // --- media upload (POST /import/media) -----------------------------------
    const mediaQuery = (sha: string) =>
        `?key=${encodeURIComponent('t/insp/i1/photos/a.jpg')}&sha256=${sha}&bytes=5&content_type=image%2Fjpeg&entry=media%2Fa.jpg&volume=media-001.zip`;
    const rawPost = (body: Uint8Array, headers: Record<string, string> = {}) => ({
        method: 'POST' as const,
        headers: {
            'content-type': 'application/octet-stream', 'content-length': String(body.length),
            'X-Data-Job': token, ...headers,
        },
        body: body as unknown as BodyInit,
    });

    it('uploads media bytes to R2 under the target tenant (step-up gated)', async () => {
        const bytes = new TextEncoder().encode('abcde');
        const sha = await sha256Hex(bytes);
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const noStep = await call(`/data-package/jobs/${JOB}/import/media${mediaQuery(sha)}`, rawPost(bytes));
        expect(noStep.status).toBe(403);
        const r = await call(`/data-package/jobs/${JOB}/import/media${mediaQuery(sha)}`, rawPost(bytes, { 'X-Step-Up-Token': stepUp }));
        expect(r.status).toBe(200);
        const data = (await r.json() as any).data;
        expect(data.ok).toBe(true);
        expect(data.newKey).toContain(TENANT);
        expect(bucketObjects.has(data.newKey)).toBe(true);
    });

    it('rejects media whose sha256 does not match the bytes (422)', async () => {
        const bytes = new TextEncoder().encode('abcde');
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const r = await call(`/data-package/jobs/${JOB}/import/media${mediaQuery('f'.repeat(64))}`, rawPost(bytes, { 'X-Step-Up-Token': stepUp }));
        expect(r.status).toBe(422);
        expect(bucketObjects.size).toBe(0);
    });

    it('requires Content-Length for media upload (411)', async () => {
        const bytes = new TextEncoder().encode('abcde');
        const sha = await sha256Hex(bytes);
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const init = rawPost(bytes, { 'X-Step-Up-Token': stepUp });
        const headers = { ...init.headers } as Record<string, string>;
        delete headers['content-length'];
        const r = await call(`/data-package/jobs/${JOB}/import/media${mediaQuery(sha)}`, { ...init, headers });
        expect(r.status).toBe(411);
    });

    // --- archive upload (PUT /import/archive) --------------------------------
    it('uploads an evidence archive and returns a verdict (step-up gated, idempotent)', async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ events: [], keys: [] }));
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const body = { events: [], keys: [] };
        const put = (headers: Record<string, string> = {}) => ({
            method: 'PUT' as const,
            headers: { 'content-type': 'application/json', 'X-Data-Job': token, ...headers },
            body: JSON.stringify(body),
        });
        const noStep = await call(`/data-package/jobs/${JOB}/import/archive`, put());
        expect(noStep.status).toBe(403);
        const r = await call(`/data-package/jobs/${JOB}/import/archive`, put({ 'X-Step-Up-Token': stepUp }));
        expect(r.status).toBe(200);
        const data = (await r.json() as any).data;
        expect(data.ok).toBe(true);
        expect(data.verdict).toBeDefined();
        expect(bucketObjects.has(`evidence-archives/${TENANT}/pkg-imp/`)).toBe(true);
        // replay: step-up is single-use, so mint another for the second call
        const { token: stepUp2 } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const again = await call(`/data-package/jobs/${JOB}/import/archive`, put({ 'X-Step-Up-Token': stepUp2 }));
        expect((await again.json() as any).data.ok).toBe(false);
    });

    it('rejects a malformed archive body (400)', async () => {
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const r = await call(`/data-package/jobs/${JOB}/import/archive`, {
            method: 'PUT', headers: { 'content-type': 'application/json', 'X-Data-Job': token, 'X-Step-Up-Token': stepUp },
            body: JSON.stringify({ events: 'not-an-array', keys: [] }),
        });
        expect(r.status).toBe(400);
    });

    it('rejects an event missing prevHash before the verifier can crash (400, not 500)', async () => {
        const { token: stepUp } = await issueStepUpToken(kv, {
            userId: USER, tenantId: TENANT, action: 'data-import-apply',
        });
        const badEvent = { id: 'e1', event: 'signer.signed', payloadJson: '{}', hash: 'h', signature: 's', keyFingerprint: 'f' };
        const r = await call(`/data-package/jobs/${JOB}/import/archive`, {
            method: 'PUT', headers: { 'content-type': 'application/json', 'X-Data-Job': token, 'X-Step-Up-Token': stepUp },
            body: JSON.stringify({ events: [badEvent], keys: [] }),
        });
        expect(r.status).toBe(400);
    });
});
