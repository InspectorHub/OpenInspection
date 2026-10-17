/**
 * The AI summary takes an inspection id in its body and builds the text from that inspection's notes, so the
 * path guard never sees it. A restricted inspector must get the answer a missing inspection gets, with no model
 * call made, and the same call must still work for an inspection inside their set.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import aiRoutes from '../../../server/api/ai';
import { AppError } from '../../../server/lib/errors';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('POST /api/ai/auto-summary honours the inspection scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    let summarise: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        summarise = vi.fn(async () => ({ summary: 'ok', aiCallId: null }));
    });

    const call = (userId: string, role: 'owner' | 'inspector', inspectionId: string) => {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            c.set('services', { ai: { generateInspectionSummary: summarise } } as never);
            await next();
        });
        app.route('/api/ai', aiRoutes);
        return app.request('/api/ai/auto-summary', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inspectionId }),
        }, { DB: {}, JWT_SECRET: 'x' } as never);
    };

    it('a restricted inspector gets 404 for an inspection outside their set, and no summary is built', async () => {
        expect((await call(USERS.inspA, 'inspector', INSP.other)).status).toBe(404);
        expect((await call(USERS.inspA, 'inspector', INSP.unassigned)).status).toBe(404);
        expect((await call(USERS.inspA, 'inspector', 'does-not-exist')).status).toBe(404);
        expect(summarise).not.toHaveBeenCalled();
    });
    it('control: the same caller can summarise their own, and an owner or an unrestricted inspector can summarise any', async () => {
        expect((await call(USERS.inspA, 'inspector', INSP.own)).status).toBe(200);
        expect((await call(USERS.owner, 'owner', INSP.other)).status).toBe(200);
        expect((await call(USERS.inspAll, 'inspector', INSP.other)).status).toBe(200);
        expect(summarise).toHaveBeenCalledTimes(3);
    });
});
