/**
 * The shared collab authorization, as a caller who sees only their assigned inspections meets it.
 * An inspection they cannot open answers exactly as a missing one does (404), never 403, so the
 * status does not tell them it exists. An unrestricted caller who is simply not on the roster is
 * still refused with 403 (control), and an assigned inspection still passes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { authorizeCollab } from '../../../server/lib/collab/authorize';
import { ensurePrimaryReportAndResults } from '../../../server/lib/inspection/primary-report';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('authorizeCollab honours the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        for (const id of [INSP.own, INSP.other]) await ensurePrimaryReportAndResults(db as never, TENANT, id, null, new Date());
    });

    async function status(userId: string, role: 'owner' | 'manager' | 'inspector', inspectionId: string): Promise<number> {
        const outer = new OpenAPIHono<HonoConfig>();
        outer.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            c.set('services', {
                inspection: { getInspection: async (id: string) => {
                    const row = await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();
                    if (!row || row.tenantId !== TENANT) throw new Error('not found');
                    return { inspection: row };
                } },
            } as never);
            await next();
        });
        outer.get('/probe/:id', async (c) => {
            const r = await authorizeCollab(c, inspectionId);
            return r.ok ? c.json({ ok: true }) : r.response;
        });
        const res = await outer.request('/probe/x', {}, { DB: {}, INSPECTION_DOC: {} } as never);
        return res.status;
    }

    it('an inspection outside the set answers 404, the same as one that does not exist', async () => {
        expect(await status(USERS.inspA, 'inspector', INSP.other)).toBe(404);
        expect(await status(USERS.inspA, 'inspector', 'no-such-id')).toBe(404);
    });
    it('a roster the stale column disagrees with is outside the set too', async () => {
        expect(await status(USERS.inspA, 'inspector', INSP.stale)).toBe(404);
    });
    it('an assigned inspection passes (control)', async () => {
        expect(await status(USERS.inspA, 'inspector', INSP.own)).toBe(200);
    });
    it('an unrestricted inspector who is not on the roster is still refused with 403 (control: the scope is what changed the status)', async () => {
        expect(await status(USERS.inspAll, 'inspector', INSP.other)).toBe(403);
    });
    it('owner and manager pass for any inspection (control)', async () => {
        expect(await status(USERS.owner, 'owner', INSP.other)).toBe(200);
        expect(await status(USERS.manager, 'manager', INSP.other)).toBe(200);
    });
});
