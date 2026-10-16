/**
 * Who may grant what.
 *
 * A manager can hand out at most what the manager holds; anything higher needs an
 * owner. Three layers are tested: the shared helper as a truth table, the
 * service (which is where the rule is enforced for every path), and the routes
 * a caller actually reaches. Every refusal has a positive control that admits
 * the same request from an actor who is allowed, so a refusal can never be a
 * check that simply says no.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { assertMayGrant, grantableRoles, grantableCapabilities, newlyGranted, type GrantActor } from '../../../server/lib/auth/grant-ceiling';
import { coerceOverrides, getCapabilities, type PermissionOverrides } from '../../../server/lib/auth/capabilities';
import type { Role } from '../../../server/lib/auth/roles';
import { AppError } from '../../../server/lib/errors';
import { TeamService } from '../../../server/services/team.service';
import teamRoutes from '../../../server/api/team';
import { applyMemberRow } from '../../../server/services/migration-intake/member-rows';
import { createTestDb, setupSchema } from '../db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { actorOf, OWNER_ACTOR } from '../helpers/grant-actor';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
vi.mock('../../../server/features/seat-quota/role-change-guard', () => ({ assertSeatForRoleChange: vi.fn().mockResolvedValue(undefined) }));
import { assertSeatForRoleChange } from '../../../server/features/seat-quota/role-change-guard';

const refusal = (code: string) => expect.objectContaining({ status: 403, code });

function actorWith(role: Role, overrides: PermissionOverrides | null): GrantActor {
    return actorOf(role, overrides);
}

describe('assertMayGrant truth table', () => {
    const run = (actor: GrantActor, toRole: Role, toOverrides: PermissionOverrides | null, from: { role: Role; overrides: PermissionOverrides | null } | null = null) =>
        () => assertMayGrant(actor, { from, to: { role: toRole, overrides: toOverrides } });

    it('owner may grant any role and any switch', () => {
        for (const role of ['owner', 'manager', 'inspector', 'staff'] as const) {
            expect(run(OWNER_ACTOR, role, { companyFinance: true, editReports: true })).not.toThrow();
        }
    });

    it('manager holding everything may invite manager, inspector and staff with any switch', () => {
        const m = actorOf('manager');
        for (const role of ['manager', 'inspector', 'staff'] as const) {
            expect(run(m, role, { companyFinance: true, editReports: true, templateDelete: true })).not.toThrow();
        }
    });

    it('manager may not grant owner (role ceiling), however it arrives', () => {
        const m = actorOf('manager');
        expect(run(m, 'owner', null)).toThrow(refusal('ROLE_CEILING'));
        expect(run(m, 'owner', null, { role: 'inspector', overrides: null })).toThrow(refusal('ROLE_CEILING'));
    });

    it('manager may not grant the agent role either', () => {
        expect(run(actorOf('manager'), 'agent', null)).toThrow(refusal('ROLE_CEILING'));
    });

    it('inspector, staff and agent actors are refused outright (fail closed)', () => {
        for (const role of ['inspector', 'staff', 'agent'] as const) {
            expect(run(actorOf(role), 'inspector', null)).toThrow(expect.objectContaining({ status: 403 }));
        }
    });

    describe('capability ceiling', () => {
        const noFinance = actorWith('manager', { companyFinance: false });

        it('refuses a switch the manager does not hold', () => {
            expect(run(noFinance, 'inspector', { companyFinance: true })).toThrow(refusal('CAPABILITY_CEILING'));
        });

        it('names the refused capability', () => {
            try {
                run(noFinance, 'inspector', { companyFinance: true })();
                expect.unreachable();
            } catch (err) {
                expect((err as AppError).details).toEqual({ capabilities: ['companyFinance'] });
            }
        });

        it('CONTROL - turning that same switch off, or leaving it alone, is allowed', () => {
            expect(run(noFinance, 'inspector', { companyFinance: false })).not.toThrow();
            expect(run(noFinance, 'inspector', null)).not.toThrow();
            expect(run(noFinance, 'inspector', { publish: false })).not.toThrow();
        });

        it('CONTROL - a switch the manager does hold is allowed', () => {
            expect(run(noFinance, 'inspector', { scheduleOthers: true })).not.toThrow();
        });

        it('counts the role template: promoting to manager grants companyFinance', () => {
            expect(run(noFinance, 'manager', null)).toThrow(refusal('CAPABILITY_CEILING'));
            expect(run(noFinance, 'manager', null, { role: 'inspector', overrides: null })).toThrow(refusal('CAPABILITY_CEILING'));
        });

        it('CONTROL - a manager who holds everything may promote to manager', () => {
            expect(run(actorOf('manager'), 'manager', null, { role: 'inspector', overrides: null })).not.toThrow();
        });

        it('does not count what the member already held (editing something else is fine)', () => {
            const from = { role: 'inspector' as const, overrides: { companyFinance: true } };
            expect(run(noFinance, 'inspector', { companyFinance: true, publish: false }, from)).not.toThrow();
            expect(run(noFinance, 'inspector', { companyFinance: true, scheduleOthers: true }, from)).not.toThrow();
        });

        it('counts a switch the member did not hold, even when the manager edits an existing member', () => {
            const from = { role: 'inspector' as const, overrides: null };
            expect(run(noFinance, 'inspector', { companyFinance: true }, from)).toThrow(refusal('CAPABILITY_CEILING'));
        });

        it('staff template grants inspectionFees: a manager without it cannot place staff', () => {
            const noFees = actorWith('manager', { inspectionFees: false });
            expect(run(noFees, 'staff', null)).toThrow(refusal('CAPABILITY_CEILING'));
            expect(run(noFees, 'staff', { inspectionFees: false })).not.toThrow();
        });

        it('editReports: a manager without it cannot give it to staff or place an inspector', () => {
            const noEdit = actorWith('manager', { editReports: false });
            expect(run(noEdit, 'staff', { editReports: true })).toThrow(refusal('CAPABILITY_CEILING'));
            expect(run(noEdit, 'inspector', null)).toThrow(refusal('CAPABILITY_CEILING'));
            expect(run(noEdit, 'staff', null)).not.toThrow();
        });

        it('legacy `financial` on the manager reads through as both money switches', () => {
            const legacy = actorWith('manager', coerceOverrides({ financial: false }));
            expect(legacy.capabilities.inspectionFees).toBe(false);
            expect(legacy.capabilities.companyFinance).toBe(false);
            expect(run(legacy, 'inspector', { inspectionFees: true })).toThrow(refusal('CAPABILITY_CEILING'));
            expect(run(legacy, 'inspector', { companyFinance: true })).toThrow(refusal('CAPABILITY_CEILING'));
            expect(run(legacy, 'inspector', { inspectionFees: false, companyFinance: false })).not.toThrow();
        });

        it('a legacy `financial` key on the TARGET is read through, not ignored', () => {
            const noFees = actorWith('manager', { inspectionFees: false, companyFinance: true });
            // The target already held both through the legacy key; the manager keeps them as they are.
            const from = { role: 'inspector' as const, overrides: coerceOverrides({ financial: true }) };
            expect(run(noFees, 'inspector', coerceOverrides({ financial: true }), from)).not.toThrow();
        });
    });

    it('the Team page offers a manager exactly the roles and switches the ceiling allows', () => {
        expect(grantableRoles('owner')).toEqual(['owner', 'manager', 'inspector', 'staff']);
        expect(grantableRoles('manager')).toEqual(['manager', 'inspector', 'staff']);
        expect(grantableRoles('inspector')).toEqual([]);
        const noFinance = actorWith('manager', { companyFinance: false });
        expect(grantableCapabilities(noFinance)).not.toContain('companyFinance');
        expect(grantableCapabilities(noFinance)).toContain('publish');
        expect(grantableCapabilities(OWNER_ACTOR)).toContain('companyFinance');
        expect(newlyGranted({ from: null, to: { role: 'inspector', overrides: null } }).sort())
            .toEqual(Object.entries(getCapabilities('inspector', null)).filter(([, v]) => v).map(([k]) => k).sort());
    });
});

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const MANAGER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const INSPECTOR = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const ENV = { JWT_SECRET: 'x', APP_BASE_URL: 'https://oi.test' };

describe('routes enforce the ceiling', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values([
            { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        const row = (id: string, role: Role, email: string) =>
            ({ id, tenantId: TENANT, email, name: email, role, passwordHash: 'x', createdAt: new Date() });
        await db.insert(schema.users).values([
            row(OWNER, 'owner', 'owner@a.test'),
            row(MANAGER, 'manager', 'manager@a.test'),
            row(INSPECTOR, 'inspector', 'inspector@a.test'),
        ]);
    });

    /**
     * The acting person is a REAL row, and the route reads their access the way
     * it does in production: `capabilitiesFor` asks a tenant-scoped database
     * handle for that row's overrides, per request. Nothing hands the actor's
     * permissions to the handler. Only the verified-token claims (who, which
     * tenant, which role) are set by hand, because the token step is not what
     * is under test; the role is read back from the row so the two cannot differ.
     */
    async function build(actingRole: 'owner' | 'manager', actingOverrides: PermissionOverrides | null = null) {
        const actingId = actingRole === 'owner' ? OWNER : MANAGER;
        await db.update(schema.users).set({ permissionOverrides: actingOverrides }).where(eq(schema.users.id, actingId));
        const actingRow = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, actingId)).get();
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.set('userRole', actingRow?.role as Role);
            c.set('tenantId', TENANT);
            c.set('user', { sub: actingId } as HonoConfig['Variables']['user']);
            c.set('profile', { hasSeatQuota: false } as HonoConfig['Variables']['profile']);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT) as unknown as HonoConfig['Variables']['sdb']);
            c.set('services', {
                team: new TeamService({} as D1Database),
                email: { sendInvitation: vi.fn().mockResolvedValue(undefined) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/team', teamRoutes);
        return app;
    }

    const { ctx, settle } = makeExecutionContext();
    const send = (app: Awaited<ReturnType<typeof build>>, method: 'POST' | 'PATCH', path: string, body: unknown) =>
        app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, ENV, ctx);
    const invite = (app: Awaited<ReturnType<typeof build>>, body: Record<string, unknown>) =>
        send(app, 'POST', '/api/team/invite', { email: 'new@a.test', notify: false, ...body });
    const patch = (app: Awaited<ReturnType<typeof build>>, id: string, body: Record<string, unknown>) =>
        send(app, 'PATCH', `/api/team/members/${id}`, body);
    const invites = () => db.select().from(schema.tenantInvites).all();
    const auditRows = async (action: string) => {
        await settle();
        return (await db.select().from(schema.auditLogs).all()).filter((r) => r.action === action);
    };
    const overridesOf = async (id: string) =>
        (await db.select({ o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, id)).get())?.o;

    describe('POST /api/team/invite', () => {
        it('refuses a manager inviting with a switch the manager does not hold, and writes nothing', async () => {
            const res = await invite(await build('manager', { companyFinance: false }), { role: 'inspector', permissionOverrides: { companyFinance: true } });
            expect(res.status).toBe(403);
            expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CAPABILITY_CEILING');
            expect(await invites()).toHaveLength(0);
        });

        it('CONTROL - the same manager may invite with that switch off', async () => {
            const res = await invite(await build('manager', { companyFinance: false }), { role: 'inspector', permissionOverrides: { companyFinance: false } });
            expect(res.status).toBe(201);
            expect(await invites()).toHaveLength(1);
        });

        it('CONTROL - an owner may invite with any switch', async () => {
            const res = await invite(await build('owner'), { role: 'inspector', permissionOverrides: { companyFinance: true } });
            expect(res.status).toBe(201);
        });

        it('refuses a manager without companyFinance inviting a manager (the template carries it)', async () => {
            const res = await invite(await build('manager', { companyFinance: false }), { role: 'manager' });
            expect(res.status).toBe(403);
            expect(await invites()).toHaveLength(0);
        });

        it('refuses a manager inviting an owner', async () => {
            const res = await invite(await build('manager'), { role: 'owner' });
            expect(res.status).toBe(403);
            expect(await invites()).toHaveLength(0);
        });
    });

    describe('PATCH /api/team/members/:id', () => {
        it('refuses a manager turning on a switch the manager does not hold, and changes nothing', async () => {
            const res = await patch(await build('manager', { companyFinance: false }), INSPECTOR, { permissionOverrides: { companyFinance: true } });
            expect(res.status).toBe(403);
            expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CAPABILITY_CEILING');
            expect(await overridesOf(INSPECTOR)).toBeNull();
        });

        it('CONTROL - the same manager may turn a switch off, and an owner may turn it on', async () => {
            expect((await patch(await build('manager', { companyFinance: false }), INSPECTOR, { permissionOverrides: { publish: false } })).status).toBe(200);
            expect(await overridesOf(INSPECTOR)).toEqual({ publish: false });
            expect((await patch(await build('owner'), INSPECTOR, { permissionOverrides: { companyFinance: true } })).status).toBe(200);
            expect(await overridesOf(INSPECTOR)).toEqual({ companyFinance: true });
        });

        it('refuses a manager promoting a member to manager when the manager lacks what the role carries', async () => {
            const res = await patch(await build('manager', { companyFinance: false }), INSPECTOR, { role: 'manager' });
            expect(res.status).toBe(403);
            expect((await db.select({ r: schema.users.role }).from(schema.users).where(eq(schema.users.id, INSPECTOR)).get())?.r).toBe('inspector');
        });

        it('refuses a manager changing their own permissions, but an unchanged save goes through', async () => {
            const app = await build('manager');
            const res = await patch(app, MANAGER, { permissionOverrides: { publish: false } });
            expect(res.status).toBe(403);
            expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SELF_PERMISSION_CHANGE');
            expect(await overridesOf(MANAGER)).toBeNull();
            // CONTROL: restating what is already stored is not a change.
            expect((await patch(app, MANAGER, { permissionOverrides: {} })).status).toBe(200);
        });

        it('records which capabilities moved, and nothing for a save that changes nothing', async () => {
            const app = await build('owner');
            expect((await patch(app, INSPECTOR, { permissionOverrides: { companyFinance: true } })).status).toBe(200);
            const rows = await auditRows('user.update');
            expect(rows).toHaveLength(1);
            expect(rows[0]?.entityId).toBe(INSPECTOR);
            expect(rows[0]?.metadata).toEqual({ role: 'inspector', capabilitiesChanged: ['companyFinance'] });
            // The same request again changes nothing: no write, no second record.
            expect((await patch(app, INSPECTOR, { permissionOverrides: { companyFinance: true } })).status).toBe(200);
            expect(await auditRows('user.update')).toHaveLength(1);
            expect(await auditRows('user.grant_refused')).toHaveLength(0);
        });

        it('records a refused grant, and the refusal comes before any seat check', async () => {
            vi.mocked(assertSeatForRoleChange).mockClear();
            const res = await patch(await build('manager', { companyFinance: false }), INSPECTOR, { role: 'manager' });
            expect(res.status).toBe(403);
            expect(assertSeatForRoleChange).not.toHaveBeenCalled();
            const refused = await auditRows('user.grant_refused');
            expect(refused).toHaveLength(1);
            expect(refused[0]?.metadata).toMatchObject({ reason: 'CAPABILITY_CEILING', role: 'manager', during: 'update' });
            expect(await auditRows('user.update')).toHaveLength(0);
            // CONTROL: the same edit by an owner passes the ceiling and does reach the seat check.
            expect((await patch(await build('owner'), INSPECTOR, { role: 'manager' })).status).toBe(200);
            expect(assertSeatForRoleChange).toHaveBeenCalledTimes(1);
        });

        it('refuses a manager promoting anyone to owner or touching an owner', async () => {
            expect((await patch(await build('manager'), INSPECTOR, { role: 'owner' })).status).toBe(403);
            expect((await patch(await build('manager'), OWNER, { permissionOverrides: { publish: false } })).status).toBe(403);
        });
    });
});

describe('service and import paths', () => {
    it('TeamService.createInvite throws on a manager actor placing an owner, with no route in the way', async () => {
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(fix.db);
        const svc = new TeamService({} as D1Database);
        await expect(svc.createInvite({ tenantId: TENANT, email: 'x@a.test', role: 'owner', actor: actorOf('manager') }))
            .rejects.toMatchObject({ status: 403, code: 'ROLE_CEILING' });
        expect(await fix.db.select().from(schema.tenantInvites).all()).toHaveLength(0);
    });

    it('a member import row needs to know who applies it, and refuses without', async () => {
        const row = { id: 'r1', conflictWith: null, payload: JSON.stringify({ email: 'x@a.test', role: 'owner' }) } as unknown as Parameters<typeof applyMemberRow>[2];
        await expect(applyMemberRow({} as D1Database, { tenantId: TENANT }, row, [])).rejects.toThrow(/who is applying/i);
    });

    it('a member import row cannot mint an owner for a manager, and may for an owner', async () => {
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(fix.db);
        await fix.db.insert(schema.tenants).values([
            { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        const row = { id: 'r1', conflictWith: null, payload: JSON.stringify({ email: 'x@a.test', role: 'owner' }) } as unknown as Parameters<typeof applyMemberRow>[2];
        await expect(applyMemberRow({} as D1Database, { tenantId: TENANT, actor: actorOf('manager') }, row, []))
            .rejects.toMatchObject({ code: 'ROLE_CEILING' });
        const dispatched: Parameters<typeof applyMemberRow>[3] = [];
        const ok = await applyMemberRow({} as D1Database, { tenantId: TENANT, actor: OWNER_ACTOR }, row, dispatched);
        expect(ok.kind).toBe('applied');
        expect(dispatched).toHaveLength(1);
    });
});
