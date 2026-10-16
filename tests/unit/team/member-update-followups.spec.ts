/**
 * Follow-ups to the grant ceiling, each with a positive control:
 *  - a failed role-change outbox append does not fail the update
 *  - an edit reports what effectively changed, and writes nothing when nothing did
 *  - the self-edit rule compares effective access; omitted overrides mean "unchanged"
 *  - the ceiling runs before the caller's seat check
 *  - a member import row refused by the ceiling leaves an audit row
 *  - the agent role gets its own explanation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TeamService } from '../../../server/services/team.service';
import { applyMemberRow } from '../../../server/services/migration-intake/member-rows';
import { Errors } from '../../../server/lib/errors';
import { logger } from '../../../server/lib/logger';
import { AUDIT_REGISTRY } from '../../../server/lib/audit-registry';
import { getCapabilities } from '../../../server/lib/auth/capabilities';
import { sameEffective } from '../../../server/lib/auth/grant-ceiling';
import type { UserSyncOutbox } from '../../../server/lib/integration/user-sync';
import type { Role } from '../../../server/lib/auth/roles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { actorOf, OWNER_ACTOR } from '../helpers/grant-actor';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const MANAGER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const INSPECTOR = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const MANAGER_CAPS = getCapabilities('manager', null);
const NO_FINANCE_CAPS = getCapabilities('manager', { companyFinance: false });

describe('member update follow-ups', () => {
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

    const stored = async (id: string) =>
        db.select({ role: schema.users.role, o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, id)).get();
    const asOwner = { tenantId: TENANT, requesterId: OWNER, requesterRole: 'owner' as const };

    describe('role_changed outbox failure', () => {
        const outboxThatFails = (): UserSyncOutbox => ({ append: vi.fn().mockRejectedValue(new Error('queue down')) }) as unknown as UserSyncOutbox;

        it('logs the failure and still completes the update', async () => {
            const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
            const svc = new TeamService({} as D1Database, outboxThatFails());
            const result = await svc.updateMember({ ...asOwner, userId: INSPECTOR, role: 'staff' });
            expect(result.role).toBe('staff');
            expect((await stored(INSPECTOR))?.role).toBe('staff');
            expect(spy).toHaveBeenCalledTimes(1);
            expect(String(spy.mock.calls[0]?.[0])).toContain('user.role_changed');
            spy.mockRestore();
        });

        it('CONTROL - a working outbox is appended to and nothing is logged', async () => {
            const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
            const append = vi.fn().mockResolvedValue(undefined);
            const svc = new TeamService({} as D1Database, { append } as unknown as UserSyncOutbox);
            await svc.updateMember({ ...asOwner, userId: INSPECTOR, role: 'staff' });
            expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'user.role_changed' }));
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('what effectively changed', () => {
        it('names the capabilities that moved', async () => {
            const svc = new TeamService({} as D1Database);
            const r = await svc.updateMember({ ...asOwner, userId: INSPECTOR, permissionOverrides: { companyFinance: true } });
            expect(r).toMatchObject({ changed: true, roleChanged: false, capabilitiesChanged: ['companyFinance'] });
        });

        it('a role move reports the capabilities the new template changes', async () => {
            const svc = new TeamService({} as D1Database);
            const r = await svc.updateMember({ ...asOwner, userId: INSPECTOR, role: 'manager' });
            expect(r.changed).toBe(true);
            expect(r.roleChanged).toBe(true);
            expect(r.capabilitiesChanged).toContain('companyFinance');
        });

        it('writes nothing and never calls beforeWrite when nothing changed', async () => {
            const svc = new TeamService({} as D1Database);
            const beforeWrite = vi.fn().mockResolvedValue(undefined);
            // `publish` is already on for an inspector: restating it is not a change.
            const same = await svc.updateMember({ ...asOwner, userId: INSPECTOR, role: 'inspector', permissionOverrides: { publish: true }, beforeWrite });
            expect(same).toMatchObject({ changed: false, capabilitiesChanged: [] });
            expect(beforeWrite).not.toHaveBeenCalled();
            // CONTROL: a real change does run it, once, with the plan.
            const real = await svc.updateMember({ ...asOwner, userId: INSPECTOR, permissionOverrides: { companyFinance: true }, beforeWrite });
            expect(real.changed).toBe(true);
            expect(beforeWrite).toHaveBeenCalledTimes(1);
        });
    });

    describe('overrides and the self-edit rule', () => {
        it('an update that omits permissionOverrides leaves stored overrides alone', async () => {
            await db.update(schema.users).set({ permissionOverrides: { companyFinance: true } }).where(eq(schema.users.id, INSPECTOR));
            const svc = new TeamService({} as D1Database);
            const r = await svc.updateMember({ ...asOwner, userId: INSPECTOR, role: 'staff' });
            expect(r.permissionOverrides).toEqual({ companyFinance: true });
            expect((await stored(INSPECTOR))?.o).toEqual({ companyFinance: true });
            // CONTROL: an explicit null does clear them.
            await svc.updateMember({ ...asOwner, userId: INSPECTOR, permissionOverrides: null });
            expect((await stored(INSPECTOR))?.o).toBeNull();
        });

        it('a manager saving their own row with the overrides omitted is not a permission change', async () => {
            await db.update(schema.users).set({ permissionOverrides: { publish: false } }).where(eq(schema.users.id, MANAGER));
            const svc = new TeamService({} as D1Database);
            const self = { tenantId: TENANT, userId: MANAGER, requesterId: MANAGER, requesterRole: 'manager' as const, requesterCapabilities: getCapabilities('manager', { publish: false }) };
            const r = await svc.updateMember(self);
            expect(r.changed).toBe(false);
            expect((await stored(MANAGER))?.o).toEqual({ publish: false });
            // CONTROL: actually changing their own access is refused.
            await expect(svc.updateMember({ ...self, permissionOverrides: { publish: false, scheduleOthers: false } }))
                .rejects.toMatchObject({ code: 'SELF_PERMISSION_CHANGE' });
        });

        it('compares effective access: clearing a stored override that restates the template is not a change', async () => {
            await db.update(schema.users).set({ permissionOverrides: { publish: true } }).where(eq(schema.users.id, MANAGER));
            const svc = new TeamService({} as D1Database);
            const self = { tenantId: TENANT, userId: MANAGER, requesterId: MANAGER, requesterRole: 'manager' as const, requesterCapabilities: MANAGER_CAPS };
            await expect(svc.updateMember({ ...self, permissionOverrides: {} })).resolves.toMatchObject({ changed: false });
            expect(sameEffective({ role: 'manager', overrides: { publish: true } }, { role: 'manager', overrides: null })).toBe(true);
            expect(sameEffective({ role: 'manager', overrides: { publish: false } }, { role: 'manager', overrides: null })).toBe(false);
        });
    });

    describe('ordering', () => {
        it('the ceiling refuses before the caller-supplied seat check runs', async () => {
            const svc = new TeamService({} as D1Database);
            const beforeWrite = vi.fn().mockResolvedValue(undefined);
            const manager = { tenantId: TENANT, userId: INSPECTOR, requesterId: MANAGER, requesterRole: 'manager' as const, requesterCapabilities: NO_FINANCE_CAPS, role: 'manager' as const, beforeWrite };
            await expect(svc.updateMember(manager)).rejects.toMatchObject({ code: 'CAPABILITY_CEILING' });
            expect(beforeWrite).not.toHaveBeenCalled();
            expect((await stored(INSPECTOR))?.role).toBe('inspector');
            // CONTROL: a manager who holds what the role carries gets through to the seat check.
            await svc.updateMember({ ...manager, requesterCapabilities: MANAGER_CAPS });
            expect(beforeWrite).toHaveBeenCalledTimes(1);
            expect((await stored(INSPECTOR))?.role).toBe('manager');
        });
    });

    describe('bulk member import', () => {
        const memberRow = (role: string) =>
            ({ id: 'r1', conflictWith: null, payload: JSON.stringify({ email: 'x@a.test', role }) }) as unknown as Parameters<typeof applyMemberRow>[2];
        const refusals = async () =>
            (await db.select().from(schema.auditLogs).all()).filter((r) => r.action === 'user.grant_refused');

        it('a row refused by the ceiling writes a user.grant_refused entry', async () => {
            const actor = { ...actorOf('manager'), userId: MANAGER };
            await expect(applyMemberRow({} as D1Database, { tenantId: TENANT, actor }, memberRow('owner'), []))
                .rejects.toMatchObject({ code: 'ROLE_CEILING' });
            const rows = await refusals();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ tenantId: TENANT, userId: MANAGER, entityType: 'user' });
            expect(rows[0]?.metadata).toEqual({ reason: 'ROLE_CEILING', role: 'owner', during: 'import' });
        });

        it('CONTROL - an allowed row and an unrelated failure write no refusal entry', async () => {
            const ok = await applyMemberRow({} as D1Database, { tenantId: TENANT, actor: { ...OWNER_ACTOR, userId: OWNER } }, memberRow('owner'), []);
            expect(ok.kind).toBe('applied');
            await expect(applyMemberRow({} as D1Database, { tenantId: TENANT, actor: OWNER_ACTOR }, memberRow('not-a-role'), []))
                .rejects.toThrow();
            expect(await refusals()).toHaveLength(0);
        });
    });

    describe('messages and registry', () => {
        it('the agent role has its own explanation, other roles keep the generic one', () => {
            const agent = Errors.RoleCeiling('agent');
            const owner = Errors.RoleCeiling('owner');
            expect(agent.code).toBe('ROLE_CEILING');
            expect(agent.message).toMatch(/agent/i);
            expect(agent.message).not.toBe(owner.message);
            expect(owner.message).toBe('Only an owner can grant that role.');
        });

        it('user.grant_refused and the user.update capability names are registered', () => {
            expect(AUDIT_REGISTRY['user.grant_refused']).toBeDefined();
            expect(AUDIT_REGISTRY['user.update'].meta).toHaveProperty('capabilitiesChanged');
        });
    });
});
