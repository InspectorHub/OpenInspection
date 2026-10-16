/**
 * Moving a member from a role that holds no seat (staff) to one that does takes
 * a seat at that moment, so it is checked like an invitation. Moves that change
 * nothing about seat holding are not asked for one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { assertSeatForRoleChange } from '../../../server/features/seat-quota/role-change-guard';
// eslint-disable-next-line import/order
import teamRoutes from '../../../server/api/team';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const ENFORCED = { enforce: true, billingPortalUrl: null } as const;
const user = (id: string, role: 'owner' | 'manager' | 'inspector' | 'staff') => ({
    id, tenantId: TENANT, email: `${id}@a.test`, name: id, role, passwordHash: 'x', createdAt: new Date(),
});

describe('seat check on a role change', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(db as never);
        // Three seats, held by owner, manager and inspector; staff hold none.
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 3, createdAt: new Date() });
        await db.insert(schema.users).values([user('o', 'owner'), user('m', 'manager'), user('i', 'inspector'), user('s', 'staff')]);
    });

    const check = (userId: string, nextRole: string, seatQuota: { enforce: boolean; billingPortalUrl: string | null } = ENFORCED) =>
        assertSeatForRoleChange({ tenantId: TENANT, userId, nextRole, db: {} as D1Database, seatQuota });

    it('refuses staff -> a seat-holding role when none is free', async () => {
        for (const next of ['inspector', 'manager']) {
            await expect(check('s', next)).rejects.toMatchObject({ code: ErrorCode.SEAT_LIMIT_REACHED });
        }
    });

    it('allows it when a seat is free, or when seats are not enforced (controls)', async () => {
        await db.update(schema.tenants).set({ maxUsers: 10 });
        await expect(check('s', 'inspector')).resolves.toBeUndefined();
        await db.update(schema.tenants).set({ maxUsers: 3 });
        await expect(check('s', 'inspector', { enforce: false, billingPortalUrl: null })).resolves.toBeUndefined();
    });

    it('does not ask for a seat when the member holds one already, or stays staff', async () => {
        await expect(check('i', 'manager')).resolves.toBeUndefined();
        await expect(check('s', 'staff')).resolves.toBeUndefined();
    });

    describe('PATCH /api/team/members/:id', () => {
        function build(hasSeatQuota: boolean) {
            // Stands in for the service's order of work: the caller's `beforeWrite`
            // (the seat check) runs first, and only after it does anything get written.
            const wrote = vi.fn();
            const updateMember = vi.fn(async (p: { beforeWrite?: (plan: unknown) => Promise<void> }) => {
                await p.beforeWrite?.({});
                wrote();
                return { id: 'm1', role: 'manager', permissionOverrides: null, changed: true, roleChanged: true, capabilitiesChanged: [] };
            });
            const app = new OpenAPIHono<HonoConfig>();
            app.onError((err, c) => (err instanceof AppError
                ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
                : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
            app.use('*', async (c, next) => {
                c.set('userRole', 'owner');
                c.set('tenantId', TENANT);
                c.set('user', { sub: 'o' } as HonoConfig['Variables']['user']);
                c.set('profile', { hasSeatQuota, billingPortalUrl: null } as HonoConfig['Variables']['profile']);
                c.set('services', { team: { updateMember } } as unknown as HonoConfig['Variables']['services']);
                await next();
            });
            app.route('/api/team', teamRoutes);
            return { app, updateMember, wrote };
        }
        const patch = (app: OpenAPIHono<HonoConfig>, role: string) => app.request('/api/team/members/s', {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }),
        }, { DB: {} }, makeExecutionContext().ctx);

        it('answers 402 and writes nothing when staff would take the last seat', async () => {
            const { app, wrote } = build(true);
            expect((await patch(app, 'inspector')).status).toBe(402);
            expect(wrote).not.toHaveBeenCalled();
        });

        it('lets the same change through where seats are not enforced (control)', async () => {
            const { app, wrote } = build(false);
            expect((await patch(app, 'inspector')).status).toBe(200);
            expect(wrote).toHaveBeenCalledTimes(1);
        });
    });
});
