/**
 * POST /api/inspections/{id}/sign (the in-person signature) is an OpenAPI route. The handler is unchanged, so these
 * pin what the conversion must not move: the ORDER of its checks (role, inspection, body, then the envelope), its own
 * hand-rolled 400, that nothing is written for a refused request, and that the operation is described without a
 * request body and kept out of MCP. The success paths, the alreadySigned short-circuits and the 409s are covered over
 * the same router by inspection-sign-unification.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import agreementSignRoutes from '../../../server/api/inspections/agreement-sign';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/rate-limit', () => ({
    checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import {
    TENANT_ID, INSP_ID, FAKE_ENV, makeExecCtx, buildApp, seedBase, SIG, postSign,
} from '../helpers/inspection-sign-unification-setup';

describe('POST /api/inspections/{id}/sign through the OpenAPI route', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    const envelopeCount = async () => (await db.select().from(schema.agreementRequests).all()).length;

    it('answers its own 400 for a body that is not a signature, creating no envelope (positive control: a valid body signs)', async () => {
        await seedBase(db);
        const { app } = buildApp(db);
        const bad = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: '' }), FAKE_ENV, makeExecCtx().ctx);
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ success: false, error: { message: 'Invalid signature data', code: 'validation_error' } });
        expect(await envelopeCount()).toBe(0);
        const notJson = await app.request(`/${INSP_ID}/sign`, { ...postSign({}), body: '{' }, FAKE_ENV, makeExecCtx().ctx);
        expect(notJson.status).toBeGreaterThanOrEqual(400);
        expect(await envelopeCount()).toBe(0);

        const ok = await app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV, makeExecCtx().ctx);
        expect(ok.status).toBe(200);
        expect(await envelopeCount()).toBe(1);
    });

    it('answers 404 for an inspection that is not in the tenant before it looks at the body', async () => {
        await seedBase(db);
        const { app } = buildApp(db);
        const res = await app.request('/no-such-inspection/sign', postSign({ signatureBase64: '' }), FAKE_ENV, makeExecCtx().ctx);
        expect(res.status).toBe(404);
        expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Inspection not found');
        expect(await envelopeCount()).toBe(0);
    });

    it('is refused for an agent before anything is read, and open to owner, manager and inspector', async () => {
        const run = (role: string) => {
            const app = new OpenAPIHono<HonoConfig>();
            app.onError((err, c) => (err instanceof AppError
                ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
                : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
            app.use('*', async (c, next) => {
                c.set('tenantId', TENANT_ID);
                c.set('userRole', role as never);
                await next();
            });
            app.route('/', agreementSignRoutes);
            return app.request(`/${INSP_ID}/sign`, postSign({ signatureBase64: SIG }), FAKE_ENV);
        };
        expect((await run('agent')).status).toBe(403);
        // Past the role gate the handler needs services this stub app does not provide, so a pass shows as a non-403.
        for (const role of ['owner', 'manager', 'inspector']) {
            expect((await run(role)).status).not.toBe(403);
        }
    });

    it('is described without a request body, as an excluded operation', () => {
        const { app } = buildApp(db);
        const doc = buildOpenApiDocument(app, { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const op = doc.paths?.['/{id}/sign']?.post as Record<string, unknown> | undefined;
        expect(op?.operationId).toBe('signInspectionAgreementInPerson');
        expect(op?.['x-tier']).toBe('excluded');
        expect(op?.['x-scopes']).toEqual([]);
        expect(op?.requestBody).toBeUndefined();
        expect(String(op?.description)).toContain('JSON body is {signatureBase64');
    });
});
