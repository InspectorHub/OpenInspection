/**
 * Bulk update against the caller's scope.
 *
 * The capability gate is the first line: scheduleOthers is switched off for anyone restricted to their
 * assigned inspections, so the route answers 403 before the handler runs. The handler also checks that every
 * named inspection is inside the caller's set, so the gate and the check cannot both be dropped by one change.
 * That second line is driven here by pinning a restricted scope on a caller who still passes the gate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import bulkRoutes from '../../../server/api/inspections/bulk';
import { AppError } from '../../../server/lib/errors';
import type { InspectionScope } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('bulk update honours the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
    });

    function build(userId: string, role: 'owner' | 'manager' | 'inspector', pinned?: InspectionScope) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            if (pinned) c.set('inspectionScope', pinned);
            await next();
        });
        app.route('/api/inspections', bulkRoutes);
        return app;
    }
    const patch = async (app: OpenAPIHono<HonoConfig>, body: unknown) => {
        const res = await app.request('/api/inspections/bulk', {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }, { DB: {} } as never);
        return res.status;
    };
    const status = async (id: string) => (await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get())?.status;
    const grant = (userId: string, overrides: Record<string, boolean>) =>
        db.update(schema.users).set({ permissionOverrides: overrides }).where(eq(schema.users.id, userId));
    const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };

    it('a restricted inspector granted scheduleOthers is refused at the gate: the grant is switched off with the scope', async () => {
        await grant(USERS.inspA, { viewAllInspections: false, scheduleOthers: true });
        expect(await patch(build(USERS.inspA, 'inspector'), { ids: [INSP.own], action: 'updateStatus', status: 'completed' })).toBe(403);
        expect(await status(INSP.own)).toBe('confirmed');
    });
    it('control: an unrestricted inspector granted scheduleOthers may bulk update', async () => {
        await grant(USERS.inspAll, { scheduleOthers: true });
        expect(await patch(build(USERS.inspAll, 'inspector'), { ids: [INSP.own, INSP.other], action: 'updateStatus', status: 'completed' })).toBe(200);
        expect(await status(INSP.other)).toBe('completed');
    });
    it('depth: a batch naming an inspection outside the set is refused whole, before any write', async () => {
        await grant(USERS.inspA, { scheduleOthers: true });
        const app = build(USERS.inspA, 'inspector', A);
        expect(await patch(app, { ids: [INSP.own, INSP.other], action: 'updateStatus', status: 'completed' })).toBe(404);
        expect(await status(INSP.own)).toBe('confirmed');
        expect(await status(INSP.other)).toBe('confirmed');
    });
    it('depth: an id that does not exist reads the same as one outside the set', async () => {
        await grant(USERS.inspA, { scheduleOthers: true });
        expect(await patch(build(USERS.inspA, 'inspector', A), { ids: [INSP.own, 'no-such-id'], action: 'updateStatus', status: 'completed' })).toBe(404);
    });
    it('depth control: a batch wholly inside the set goes through', async () => {
        await grant(USERS.inspA, { scheduleOthers: true });
        expect(await patch(build(USERS.inspA, 'inspector', A), { ids: [INSP.own, INSP.team, INSP.legacy], action: 'updateStatus', status: 'completed' })).toBe(200);
        expect(await status(INSP.own)).toBe('completed');
        expect(await status(INSP.team)).toBe('completed');
        expect(await status(INSP.other)).toBe('confirmed');
    });
    it('depth: a reassignment that names an outside inspection is refused and the roster is untouched', async () => {
        await grant(USERS.inspA, { scheduleOthers: true });
        expect(await patch(build(USERS.inspA, 'inspector', A), { ids: [INSP.other], action: 'assignInspector', inspectorId: USERS.inspA })).toBe(404);
        const roster = await db.select().from(schema.inspectionInspectors).where(eq(schema.inspectionInspectors.inspectionId, INSP.other)).all();
        expect(roster.map(r => r.userId)).toEqual([USERS.inspB]);
    });
    it('control: the administrator tier is not narrowed', async () => {
        expect(await patch(build(USERS.manager, 'manager'), { ids: [INSP.other, INSP.unassigned], action: 'updateStatus', status: 'completed' })).toBe(200);
    });
});
