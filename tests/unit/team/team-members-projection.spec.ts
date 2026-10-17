/**
 * GET /api/team/members hands each tier the roster it needs. The administrator tier gets every
 * column; anyone else gets enough to name a colleague, and the email as well when they may schedule
 * for others. The reduced shape is asserted by key, not by absence of a few names, so a column
 * added to the roster later cannot slip into it unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import teamRoutes from '../../../server/api/team';
import { projectMembers } from '../../../server/lib/team/member-projection';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

const TENANT = '00000000-0000-0000-0000-000000000001';
const FAKE_ENV = { DB: {}, APP_BASE_URL: 'https://oi.test' } as unknown as HonoConfig['Bindings'];

const MEMBERS = [
    { id: 'u-1', name: 'Ada', email: 'ada@a.test', role: 'inspector', permissionOverrides: { companyFinance: true }, totpEnabled: true, createdAt: new Date('2026-01-01T00:00:00Z'), lastActiveAt: new Date('2026-10-01T00:00:00Z') },
    { id: 'u-2', name: null, email: 'bo@a.test', role: 'manager', permissionOverrides: null, totpEnabled: false, createdAt: new Date('2026-02-01T00:00:00Z'), lastActiveAt: null },
];

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500));
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: TENANT });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            team: { getMembers: async () => ({ activeUsers: MEMBERS, pendingInvites: [], maxUsers: 5 }) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/team', teamRoutes);
    return app;
}

async function members(role: UserRole, overrides: Record<string, boolean> | null = null) {
    const res = await buildApp(role, overrides).request('/api/team/members', {}, FAKE_ENV);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { members: Array<Record<string, unknown>> } }).data.members;
}

describe('GET /api/team/members: the roster each tier receives', () => {
    it('owner and manager receive every column (positive control)', async () => {
        for (const role of ['owner', 'manager'] as const) {
            const m = await members(role);
            expect(Object.keys(m[0]!).sort(), role).toEqual(['createdAt', 'email', 'id', 'lastActiveAt', 'name', 'permissionOverrides', 'role', 'totpEnabled']);
            expect(m[0]!.permissionOverrides).toEqual({ companyFinance: true });
            expect(m[0]!.totpEnabled).toBe(true);
        }
    });

    it('an inspector receives id, name and role only', async () => {
        const m = await members('inspector');
        expect(m).toHaveLength(2);
        for (const row of m) expect(Object.keys(row).sort()).toEqual(['id', 'name', 'role']);
        expect(m[0]).toEqual({ id: 'u-1', name: 'Ada', role: 'inspector' });
        expect(JSON.stringify(m)).not.toContain('a.test');
    });

    it('an inspector allowed to schedule for others also receives the email, and nothing more', async () => {
        const m = await members('inspector', { scheduleOthers: true });
        for (const row of m) expect(Object.keys(row).sort()).toEqual(['email', 'id', 'name', 'role']);
        expect(m[0]!.email).toBe('ada@a.test');
    });

    it('a restricted inspector cannot reach the email by being granted scheduleOthers (the grant is normalised away)', async () => {
        const m = await members('inspector', { viewAllInspections: false, scheduleOthers: true });
        for (const row of m) expect(Object.keys(row).sort()).toEqual(['id', 'name', 'role']);
    });

    it('office staff, who schedule for others by default, receive the email', async () => {
        const m = await members('staff');
        for (const row of m) expect(Object.keys(row).sort()).toEqual(['email', 'id', 'name', 'role']);
    });
});

describe('projectMembers', () => {
    const full = [{ id: 'a', name: 'A', email: 'a@x.test', role: 'inspector', secret: 's', lastActiveAt: null }];
    it('keeps only what it names: a column added to the roster later stays out of the reduced view', () => {
        const reduced = projectMembers(full, { administrator: false, schedulesOthers: false });
        expect(Object.keys(reduced[0]!)).toEqual(['id', 'name', 'role']);
        expect(Object.keys(projectMembers(full, { administrator: false, schedulesOthers: true })[0]!).sort()).toEqual(['email', 'id', 'name', 'role']);
    });
    it('hands the administrator tier the rows untouched', () => {
        expect(projectMembers(full, { administrator: true, schedulesOthers: true })).toEqual(full);
    });
});
