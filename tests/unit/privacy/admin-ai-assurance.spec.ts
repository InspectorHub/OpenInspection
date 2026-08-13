/**
 * `GET /api/admin/compliance/ai-assurance` — the workspace-facing read of the
 * AI accountability ledgers.
 *
 * The route is thin on purpose; `assurance-records.spec.ts` owns the query
 * semantics. What is asserted HERE is everything the module cannot see:
 *   - the role gate (an inspector must not read the workspace's AI ledger, and
 *     the erasure-log sibling this is shaped after is owner/manager too),
 *   - that the scope comes from the SESSION and not the query string — the
 *     single failure that would turn a compliance view into a cross-tenant read,
 *   - and that the paging input is validated rather than passed through.
 *
 * These are HTTP-status assertions against the real router, not a stubbed
 * handler: a spec built above the middleware would pass with no guard at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import adminRoutes from '../../../server/api/admin';
import { AppError } from '../../../server/lib/errors';

/** Mirrors server/index.ts's global onError — without it a thrown AppError
 *  (Errors.Forbidden from requireRole) surfaces as a generic 500 and the role
 *  assertions below would be measuring the harness, not the guard. */
function withErrorHandler(app: OpenAPIHono<HonoConfig>) {
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    return app;
}

const TENANT = 't-mine';
const OTHER  = 't-theirs';
const PATH   = '/api/admin/compliance/ai-assurance';

interface AssuranceBody {
    success: boolean;
    data: {
        calls: Array<{ id: string; model: string; promptVersion: string; reviews: Array<{ id: string }> }>;
        unresolvedReviewCount: number;
        nextBefore: number | null;
    };
}

describe('GET /api/admin/compliance/ai-assurance', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    function buildApp(role: string, tenantId = TENANT) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', role as never);
            c.set('tenantId', tenantId);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        return { app: withErrorHandler(app), env: { DB: {}, JWT_SECRET: 'x' } };
    }

    beforeEach(async () => {
        const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.aiCallProvenance).values([
            { id: 'call-mine',   tenantId: TENANT, capability: 'assist', provider: 'gemini', mode: 'byo', model: 'm-1', promptVersion: 'professional-comment.v1', createdAt: new Date(2_000) },
            { id: 'call-theirs', tenantId: OTHER,  capability: 'assist', provider: 'gemini', mode: 'byo', model: 'm-9', promptVersion: 'professional-comment.v1', createdAt: new Date(3_000) },
        ] as never);
        await testDb.insert(schema.aiContentReviews).values([
            { id: 'rev-mine', tenantId: TENANT, artifactType: 'inspection_result', artifactId: 'a1', reviewedBy: 'u1', reviewedAt: new Date(2_500), aiCallId: 'call-mine' },
        ] as never);
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('returns the workspace ledger to an owner', async () => {
        const { app, env } = buildApp('owner');
        const res = await app.request(PATH, {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as AssuranceBody;
        expect(body.data.calls.map(c => c.id)).toEqual(['call-mine']);
        expect(body.data.calls[0].reviews.map(r => r.id)).toEqual(['rev-mine']);
        expect(body.data.calls[0].model).toBe('m-1');
        expect(body.data.calls[0].promptVersion).toBe('professional-comment.v1');
    });

    it('returns the workspace ledger to a manager', async () => {
        const { app, env } = buildApp('manager');
        const res = await app.request(PATH, {}, env);
        expect(res.status).toBe(200);
    });

    it('403s an inspector', async () => {
        const { app, env } = buildApp('inspector');
        const res = await app.request(PATH, {}, env);
        expect(res.status).toBe(403);
    });

    it('403s an agent', async () => {
        const { app, env } = buildApp('agent');
        const res = await app.request(PATH, {}, env);
        expect(res.status).toBe(403);
    });

    it('ignores a tenantId supplied in the query — the scope is the session', async () => {
        const { app, env } = buildApp('owner');
        const res = await app.request(`${PATH}?tenantId=${OTHER}`, {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as AssuranceBody;
        expect(body.data.calls.map(c => c.id)).toEqual(['call-mine']);
    });

    it('serves the other workspace only to a session that belongs to it', async () => {
        const { app, env } = buildApp('owner', OTHER);
        const res = await app.request(PATH, {}, env);
        const body = await res.json() as AssuranceBody;
        expect(body.data.calls.map(c => c.id)).toEqual(['call-theirs']);
    });

    it('400s a limit outside the allowed page range', async () => {
        const { app, env } = buildApp('owner');
        const res = await app.request(`${PATH}?limit=9999`, {}, env);
        expect(res.status).toBe(400);
    });

    it('honours the before cursor', async () => {
        const { app, env } = buildApp('owner');
        const res = await app.request(`${PATH}?before=1000`, {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as AssuranceBody;
        expect(body.data.calls).toEqual([]);
    });

    it('is read-only: the path rejects a POST', async () => {
        const { app, env } = buildApp('owner');
        const res = await app.request(PATH, { method: 'POST' }, env);
        expect(res.status).toBe(404);
    });
});
