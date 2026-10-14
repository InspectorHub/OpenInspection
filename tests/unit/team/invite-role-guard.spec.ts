/**
 * Who may be invited as what.
 *
 * Both invite endpoints are open to managers, and the role on the invite is
 * copied verbatim onto the new user at accept time. Without a rank check a
 * manager could invite an address as `owner` and accept it themselves, ending
 * up with a second owner -- after which the "last owner" protection no longer
 * protects the real one. The rule is the same one remove/update already apply:
 * only an owner may mint an owner.
 *
 * `agent` is not a team role at all. `TeamService.updateMember` refuses it
 * because agents are granted access per inspection, so the invite door has to
 * refuse it too or the Team page grows a second, contradictory way in.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import teamRoutes from '../../../server/api/team';
import adminRoutes from '../../../server/api/admin';
import { AppError } from '../../../server/lib/errors';
import { makeExecutionContext } from '../helpers/exec-ctx';
import type { HonoConfig } from '../../../server/types/hono';

type RequesterRole = 'owner' | 'manager';

function buildApp(requesterRole: RequesterRole) {
    const createTeamInvite = vi.fn().mockResolvedValue({ token: 'tok-1', expiresAt: new Date('2030-01-01T00:00:00Z') });
    const createAdminInvite = vi.fn().mockResolvedValue({ inviteId: 'tok-2', expiresAt: new Date('2030-01-01T00:00:00Z') });
    const sendInvitation = vi.fn().mockResolvedValue(undefined);
    const app = new OpenAPIHono<HonoConfig>();
    // Mirrors server/index.ts's global onError, which this bare app does not have.
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('userRole', requesterRole);
        c.set('tenantId', 't1');
        c.set('user', { sub: 'u-1' } as HonoConfig['Variables']['user']);
        c.set('profile', { hasSeatQuota: false } as HonoConfig['Variables']['profile']);
        c.set('services', {
            team: { createInvite: createTeamInvite },
            admin: { createInvite: createAdminInvite },
            email: { sendInvitation },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/team', teamRoutes);
    app.route('/api/admin', adminRoutes);
    return { app, createTeamInvite, createAdminInvite };
}

const EXECUTION_CTX = makeExecutionContext().ctx;
const ENV = { JWT_SECRET: 'x', APP_BASE_URL: 'https://oi.test' };

function post(app: OpenAPIHono<HonoConfig>, path: string, role: string) {
    return app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@y.test', role, notify: false }),
    }, ENV, EXECUTION_CTX);
}

// The admin endpoint enforces the owner rule inside AdminService.createInvite
// (see tests/unit/admin/admin.service.spec.ts); the team endpoint enforces it
// in the handler, so only it can be asserted at the route.
describe('POST /api/team/invite owner rule', () => {
    it('forbids a manager from inviting an owner and writes nothing', async () => {
        const built = buildApp('manager');
        const res = await post(built.app, '/api/team/invite', 'owner');
        expect(res.status).toBe(403);
        expect(built.createTeamInvite).not.toHaveBeenCalled();
    });

    it('CONTROL - an owner may invite an owner', async () => {
        const built = buildApp('owner');
        const res = await post(built.app, '/api/team/invite', 'owner');
        expect(res.status).toBe(201);
        expect(built.createTeamInvite).toHaveBeenCalledTimes(1);
    });
});

describe.each([
    { path: '/api/team/invite', pick: (b: ReturnType<typeof buildApp>) => b.createTeamInvite },
    { path: '/api/admin/invite', pick: (b: ReturnType<typeof buildApp>) => b.createAdminInvite },
])('POST $path role rules', ({ path, pick }) => {
    it('CONTROL - a manager may invite an inspector', async () => {
        const built = buildApp('manager');
        const res = await post(built.app, path, 'inspector');
        expect(res.status).toBe(201);
        expect(pick(built)).toHaveBeenCalledTimes(1);
    });

    it('CONTROL - a manager may invite a manager', async () => {
        const built = buildApp('manager');
        const res = await post(built.app, path, 'manager');
        expect(res.status).toBe(201);
    });

    it.each(['owner', 'manager'] as const)('refuses the agent role for a %s requester', async (requester) => {
        const built = buildApp(requester);
        const res = await post(built.app, path, 'agent');
        expect(res.status).toBe(400);
        expect(pick(built)).not.toHaveBeenCalled();
    });
});
