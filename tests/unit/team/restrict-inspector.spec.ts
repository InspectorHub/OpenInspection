/**
 * Restricting an inspector to their assigned inspections, end to end through the team routes.
 *
 * What an administrator can now write (member edit, invite, member import), what is stored, what
 * is recorded in the audit trail, and what the restricted person then sees. Every restriction is
 * paired with a control that goes through (another switch, another role, another actor).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { applyMemberRow } from '../../../server/services/migration-intake/member-rows';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { buildTeamApp, TEAM_ENV } from '../helpers/team-routes-harness';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { OWNER_ACTOR } from '../helpers/grant-actor';
import { seedVisibilityFixture, TENANT, USERS, VISIBLE_TO_A, ALL_OF_TENANT } from '../helpers/visibility-fixture';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
vi.mock('../../../server/features/seat-quota/role-change-guard', () => ({ assertSeatForRoleChange: vi.fn().mockResolvedValue(undefined) }));

const ENV = TEAM_ENV;
const RESTRICT = { viewAllInspections: false };

describe('restricting an inspector through the team routes', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seedVisibilityFixture(db);
        // The fixture restricts three inspectors up front; these specs start from a clean slate for inspA.
        await db.update(schema.users).set({ permissionOverrides: null }).where(eq(schema.users.id, USERS.inspA));
    });

    const actAs = (userId: string, role: 'owner' | 'manager' | 'inspector') => buildTeamApp(db, TENANT, userId, role);
    const { ctx, settle } = makeExecutionContext();
    const send = (app: OpenAPIHono<HonoConfig>, method: 'POST' | 'PATCH', path: string, body: unknown) =>
        app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, ENV, ctx);
    const patch = (app: OpenAPIHono<HonoConfig>, id: string, body: Record<string, unknown>) => send(app, 'PATCH', `/api/team/members/${id}`, body);
    const overridesOf = async (id: string) =>
        (await db.select({ o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, id)).get())?.o;
    const auditRows = async (action: string) => {
        await settle();
        return (await db.select().from(schema.auditLogs).all()).filter((r) => r.action === action);
    };
    const listFor = async (userId: string) => {
        const res = await actAs(userId, 'inspector').request('/api/inspections?limit=100', {}, ENV, ctx);
        expect(res.status, await res.clone().text()).toBe(200);
        return ((await res.json()) as { data: Array<{ id: string }> }).data.map((i) => i.id).sort();
    };

    describe('PATCH /api/team/members/:id', () => {
        it('an owner restricts an inspector: the scope is stored as a difference from the role, and the next list is the assigned set', async () => {
            expect(await listFor(USERS.inspA)).toEqual([...ALL_OF_TENANT].sort());
            const res = await patch(actAs(USERS.owner, 'owner'), USERS.inspA, { permissionOverrides: RESTRICT });
            expect(res.status, await res.clone().text()).toBe(200);
            expect(await overridesOf(USERS.inspA)).toEqual(RESTRICT);
            expect(await listFor(USERS.inspA)).toEqual([...VISIBLE_TO_A].sort());
        });
        it('a manager may do the same; only an explicit true lifts it, an empty or partial map never does', async () => {
            const app = actAs(USERS.manager, 'manager');
            expect((await patch(app, USERS.inspA, { permissionOverrides: RESTRICT })).status).toBe(200);
            expect(await listFor(USERS.inspA)).toEqual([...VISIBLE_TO_A].sort());
            // An API or MCP client that does not mention the scope must not lift it by accident.
            expect((await patch(app, USERS.inspA, { permissionOverrides: {} })).status).toBe(200);
            expect(await overridesOf(USERS.inspA)).toEqual(RESTRICT);
            expect((await patch(app, USERS.inspA, { permissionOverrides: { publish: false } })).status).toBe(200);
            expect(await overridesOf(USERS.inspA)).toEqual({ ...RESTRICT, publish: false });
            expect(await listFor(USERS.inspA)).toEqual([...VISIBLE_TO_A].sort());
            // Control: saying it out loud does lift it, and the other switch is replaced as before.
            expect((await patch(app, USERS.inspA, { permissionOverrides: { viewAllInspections: true } })).status).toBe(200);
            expect(await overridesOf(USERS.inspA)).toBeNull();
            expect(await listFor(USERS.inspA)).toEqual([...ALL_OF_TENANT].sort());
        });
        it('the restricted inspector cannot lift it themselves (control: they cannot reach the route at all)', async () => {
            await patch(actAs(USERS.owner, 'owner'), USERS.inspA, { permissionOverrides: RESTRICT });
            const own = await patch(actAs(USERS.inspA, 'inspector'), USERS.inspA, { permissionOverrides: {} });
            expect(own.status).toBe(403);
            expect(await overridesOf(USERS.inspA)).toEqual(RESTRICT);
        });
        it('is recorded as a capability change on the member, naming the capability and nothing else about them', async () => {
            const app = actAs(USERS.owner, 'owner');
            expect((await patch(app, USERS.inspA, { permissionOverrides: RESTRICT })).status).toBe(200);
            const rows = await auditRows('user.update');
            expect(rows).toHaveLength(1);
            expect(rows[0]?.entityId).toBe(USERS.inspA);
            expect(rows[0]?.metadata).toEqual({ role: 'inspector', capabilitiesChanged: ['viewAllInspections'] });
            expect(JSON.stringify(rows[0]?.metadata)).not.toContain('@');
            // Saying the same thing again changes nothing, so records nothing.
            expect((await patch(app, USERS.inspA, { permissionOverrides: RESTRICT })).status).toBe(200);
            expect(await auditRows('user.update')).toHaveLength(1);
        });
        it('control: a switch that is not the scope is stored beside it, and a role that is pinned drops the request', async () => {
            const app = actAs(USERS.owner, 'owner');
            expect((await patch(app, USERS.inspA, { permissionOverrides: { ...RESTRICT, publish: false } })).status).toBe(200);
            expect(await overridesOf(USERS.inspA)).toEqual({ viewAllInspections: false, publish: false });
            // A manager's view of every inspection is pinned: asking for the opposite is stored as nothing.
            expect((await patch(app, USERS.manager, { permissionOverrides: RESTRICT })).status).toBe(200);
            expect(await overridesOf(USERS.manager)).toBeNull();
        });
        it('a restricted inspector granted scheduleOthers is stored as asked but never holds it', async () => {
            const app = actAs(USERS.owner, 'owner');
            expect((await patch(app, USERS.inspA, { permissionOverrides: { ...RESTRICT, scheduleOthers: true } })).status).toBe(200);
            const bulk = await send(actAs(USERS.inspA, 'inspector'), 'PATCH', '/api/inspections/bulk', { ids: ['i-own'], action: 'updateStatus', status: 'completed' });
            expect(bulk.status).toBe(403);
        });
    });

    describe('POST /api/team/invite', () => {
        it('an invite can carry the restriction, and it is stored on the invite', async () => {
            const res = await send(actAs(USERS.owner, 'owner'), 'POST', '/api/team/invite', {
                email: 'new@a.test', notify: false, role: 'inspector', permissionOverrides: RESTRICT,
            });
            expect(res.status, await res.clone().text()).toBe(201);
            const invite = await db.select().from(schema.tenantInvites).get();
            expect(invite?.permissionOverrides).toEqual(RESTRICT);
        });
        it('control: the same invite for a manager stores nothing, because the role pins the scope', async () => {
            const res = await send(actAs(USERS.owner, 'owner'), 'POST', '/api/team/invite', {
                email: 'mgr@a.test', notify: false, role: 'manager', permissionOverrides: RESTRICT,
            });
            expect(res.status).toBe(201);
            const invite = await db.select().from(schema.tenantInvites).get();
            expect(invite?.permissionOverrides ?? null).toBeNull();
        });
    });

    describe('member import', () => {
        const rowFor = (payload: Record<string, unknown>) =>
            ({ id: 'r1', conflictWith: null, payload: JSON.stringify(payload) }) as unknown as Parameters<typeof applyMemberRow>[2];
        it('a row carrying the restriction lands on the new invite', async () => {
            const dispatched: Parameters<typeof applyMemberRow>[3] = [];
            const out = await applyMemberRow({} as D1Database, { tenantId: TENANT, actor: OWNER_ACTOR },
                rowFor({ email: 'imp@a.test', role: 'inspector', permissionOverrides: RESTRICT }), dispatched);
            expect(out.kind).toBe('applied');
            const invite = await db.select().from(schema.tenantInvites).where(eq(schema.tenantInvites.email, 'imp@a.test')).get();
            expect(invite?.permissionOverrides).toEqual(RESTRICT);
        });
        it('control: the same row for a manager stores nothing', async () => {
            const dispatched: Parameters<typeof applyMemberRow>[3] = [];
            await applyMemberRow({} as D1Database, { tenantId: TENANT, actor: OWNER_ACTOR },
                rowFor({ email: 'impm@a.test', role: 'manager', permissionOverrides: RESTRICT }), dispatched);
            const invite = await db.select().from(schema.tenantInvites).where(eq(schema.tenantInvites.email, 'impm@a.test')).get();
            expect(invite?.permissionOverrides ?? null).toBeNull();
        });
    });
});
