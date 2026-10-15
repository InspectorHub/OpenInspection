/**
 * GET /api/team/members — pending invitations are a bearer credential.
 *
 * The invite id IS the accept token (`POST /api/auth/join` takes it), and the
 * list returns each invitation with its accept link. An inspector who could read
 * a pending manager/owner invitation could accept it first, with the invitee's
 * email and a password of their own, and be created with the invited role.
 * Members and the seat cap stay readable by inspectors; invitations do not.
 *
 * The negative assertions run against a fixture that DOES hold a pending
 * invitation (proved by the owner and manager cases), so an empty list is not a
 * vacuous pass.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import teamRoutes from '../../../server/api/team';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INVITE_ID = 'f3a9c1d2-7b44-4e0a-9c55-1d2e3f4a5b6c';
const FAKE_ENV = { DB: {}, APP_BASE_URL: 'https://oi.test' } as unknown as HonoConfig['Bindings'];

const MEMBER = {
    id: 'u-1', name: 'Ada', email: 'ada@a.test', role: 'inspector',
    permissionOverrides: null, totpEnabled: false, createdAt: new Date(), lastActiveAt: null,
};
const INVITE = {
    id: INVITE_ID, tenantId: TENANT, email: 'future-owner@a.test', role: 'owner',
    status: 'pending', expiresAt: new Date('2030-01-01T00:00:00.000Z'), createdAt: new Date(),
};

function buildApp(role: UserRole) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: TENANT });
        c.set('services', {
            team: { getMembers: async () => ({ activeUsers: [MEMBER], pendingInvites: [INVITE], maxUsers: 5 }) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/team', teamRoutes);
    return app;
}

interface MembersBody {
    data: { members: unknown[]; invites: Array<{ id: string; inviteLink: string }>; maxUsers: number };
}

async function listMembers(role: UserRole) {
    const res = await buildApp(role).request('/api/team/members', {}, FAKE_ENV);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as MembersBody };
}

describe('GET /api/team/members — invitation visibility', () => {
    it('owner receives the pending invitation with its accept link (positive control)', async () => {
        const r = await listMembers('owner');
        expect(r.status).toBe(200);
        expect(r.body.data.invites).toHaveLength(1);
        expect(r.body.data.invites[0]?.id).toBe(INVITE_ID);
        expect(r.body.data.invites[0]?.inviteLink).toBe(`https://oi.test/join?token=${INVITE_ID}`);
    });

    it('manager receives the pending invitation with its accept link (positive control)', async () => {
        const r = await listMembers('manager');
        expect(r.status).toBe(200);
        expect(r.body.data.invites.map((i) => i.id)).toEqual([INVITE_ID]);
        expect(r.body.data.invites[0]?.inviteLink).toContain('/join?token=');
    });

    it('inspector gets an empty invites list and no invite id or accept link anywhere in the body', async () => {
        const r = await listMembers('inspector');
        expect(r.status).toBe(200);
        expect(r.body.data.invites).toEqual([]);
        expect(r.text).not.toContain(INVITE_ID);
        expect(r.text).not.toContain('/join?token=');
        expect(r.text).not.toContain('future-owner@a.test');
    });

    it('inspector still receives members and the seat cap (the page depends on them)', async () => {
        const r = await listMembers('inspector');
        expect(r.body.data.members).toHaveLength(1);
        expect(r.body.data.maxUsers).toBe(5);
    });
});
