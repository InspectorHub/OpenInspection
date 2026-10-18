/**
 * Permission templates over HTTP: the list, create / change / archive, and
 * applying a template through the invite and member-edit routes.
 *
 * The acting person is a real row and the routes read their access the way they
 * do in production. Every refusal has a positive control that admits the same
 * request from someone allowed, so a refusal is never a check that just says no.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PermissionOverrides } from '../../../server/lib/auth/capabilities';
import type { Role } from '../../../server/lib/auth/roles';
import { AppError } from '../../../server/lib/errors';
import { TeamService } from '../../../server/services/team.service';
import teamRoutes from '../../../server/api/team';
import { createTestDb, setupSchema } from '../db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
vi.mock('../../../server/features/seat-quota/role-change-guard', () => ({ assertSeatForRoleChange: vi.fn().mockResolvedValue(undefined) }));

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER_TENANT = '11111111-1111-1111-1111-1111111111b2';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const MANAGER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const INSPECTOR = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const ENV = { JWT_SECRET: 'x', APP_BASE_URL: 'https://oi.test' };

type Acting = 'owner' | 'manager' | 'inspector';

describe('permission template routes', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values([
            { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        const row = (id: string, role: Role, email: string) =>
            ({ id, tenantId: TENANT, email, name: email, role, passwordHash: 'x', createdAt: new Date() });
        await db.insert(schema.users).values([
            row(OWNER, 'owner', 'owner@a.test'),
            row(MANAGER, 'manager', 'manager@a.test'),
            row(INSPECTOR, 'inspector', 'inspector@a.test'),
        ]);
    });

    async function build(acting: Acting, actingOverrides: PermissionOverrides | null = null) {
        const id = { owner: OWNER, manager: MANAGER, inspector: INSPECTOR }[acting];
        await db.update(schema.users).set({ permissionOverrides: actingOverrides }).where(eq(schema.users.id, id));
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.set('userRole', acting);
            c.set('tenantId', TENANT);
            c.set('user', { sub: id } as HonoConfig['Variables']['user']);
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

    type App = Awaited<ReturnType<typeof build>>;
    const { ctx, settle } = makeExecutionContext();
    const send = (app: App, method: string, path: string, body?: unknown) =>
        app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, ENV, ctx);
    const json = async <T,>(res: Response) => (await res.json()) as T;
    const create = (app: App, body: Record<string, unknown>) => send(app, 'POST', '/api/team/permission-templates', body);
    const invite = (app: App, body: Record<string, unknown>) => send(app, 'POST', '/api/team/invite', { email: 'new@a.test', notify: false, ...body });
    const invites = () => db.select().from(schema.tenantInvites).all();
    const auditRows = async (action: string) => {
        await settle();
        return (await db.select().from(schema.auditLogs).all()).filter((r) => r.action === action);
    };
    const userRow = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).get();

    interface Listed { id: string; system: boolean; name: string; baseRole: string; overrides: Record<string, boolean> }

    describe('GET /api/team/permission-templates', () => {
        it('returns the built-in templates then the company\'s own, built-ins marked system', async () => {
            const owner = await build('owner');
            const made = await json<{ data: Listed }>(await create(owner, { name: 'Weekend helper', baseRole: 'inspector', overrides: { publish: false } }));
            const res = await send(owner, 'GET', '/api/team/permission-templates');
            expect(res.status).toBe(200);
            const body = await json<{ data: { templates: Listed[]; maxCompanyTemplates: number } }>(res);
            const system = body.data.templates.filter((t) => t.system);
            expect(system.map((t) => t.id)).toContain('inspector_trainee');
            expect(system.find((t) => t.id === 'inspector_standard')?.overrides).toEqual({});
            expect(system.find((t) => t.id === 'inspector_trainee')?.overrides).toMatchObject({ publish: false });
            const own = body.data.templates.filter((t) => !t.system);
            expect(own).toEqual([expect.objectContaining({ id: made.data.id, name: 'Weekend helper', baseRole: 'inspector', overrides: { publish: false } })]);
            expect(body.data.templates.indexOf(own[0]!)).toBeGreaterThan(body.data.templates.lastIndexOf(system.at(-1)!) - 1);
            expect(body.data.maxCompanyTemplates).toBe(25);
        });

        it('is refused for an inspector with the role named, and allowed for a manager (control)', async () => {
            const refused = await send(await build('inspector'), 'GET', '/api/team/permission-templates');
            expect(refused.status).toBe(403);
            expect((await json<{ error: { message: string } }>(refused)).error.message).toMatch(/Inspector/);
            expect((await send(await build('manager'), 'GET', '/api/team/permission-templates')).status).toBe(200);
        });

        it('does not show another company\'s templates', async () => {
            await db.insert(schema.permissionTemplates).values({
                id: 'theirs', tenantId: OTHER_TENANT, name: 'Theirs', baseRole: 'staff', overrides: {}, createdAt: new Date(), updatedAt: new Date(),
            });
            const body = await json<{ data: { templates: Listed[] } }>(await send(await build('owner'), 'GET', '/api/team/permission-templates'));
            expect(body.data.templates.map((t) => t.id)).not.toContain('theirs');
        });
    });

    describe('create, change, archive', () => {
        it('creates, renames and archives, with an audit row each that carries no email', async () => {
            const owner = await build('owner');
            const created = await create(owner, { name: 'Field trainee', baseRole: 'inspector', overrides: { publish: false } });
            expect(created.status).toBe(201);
            const id = (await json<{ data: Listed }>(created)).data.id;

            const updated = await send(owner, 'PUT', `/api/team/permission-templates/${id}`, { name: 'Trainee', baseRole: 'inspector', overrides: { publish: false, deleteInspection: false } });
            expect(updated.status).toBe(200);
            expect((await json<{ data: Listed }>(updated)).data).toMatchObject({ name: 'Trainee', overrides: { publish: false, deleteInspection: false } });

            const archived = await send(owner, 'DELETE', `/api/team/permission-templates/${id}`);
            expect(archived.status).toBe(200);
            const listed = await json<{ data: { templates: Listed[] } }>(await send(owner, 'GET', '/api/team/permission-templates'));
            expect(listed.data.templates.some((t) => t.id === id)).toBe(false);

            for (const action of ['permission_template.create', 'permission_template.update', 'permission_template.archive']) {
                const rows = await auditRows(action);
                expect(rows, action).toHaveLength(1);
                expect(rows[0]?.entityId).toBe(id);
                expect(JSON.stringify(rows[0]?.metadata ?? '')).not.toMatch(/@/);
            }
        });

        it('built-in templates cannot be changed or archived (400), and the control on a company one works', async () => {
            const owner = await build('owner');
            const put = await send(owner, 'PUT', '/api/team/permission-templates/inspector_trainee', { name: 'X', baseRole: 'inspector' });
            expect(put.status).toBe(400);
            expect((await send(owner, 'DELETE', '/api/team/permission-templates/inspector_trainee')).status).toBe(400);
            const made = await json<{ data: Listed }>(await create(owner, { name: 'Mine', baseRole: 'staff' }));
            expect((await send(owner, 'DELETE', `/api/team/permission-templates/${made.data.id}`)).status).toBe(200);
        });

        it('another company\'s template id is a 404 for change and archive', async () => {
            await db.insert(schema.permissionTemplates).values({
                id: 'theirs', tenantId: OTHER_TENANT, name: 'Theirs', baseRole: 'staff', overrides: {}, createdAt: new Date(), updatedAt: new Date(),
            });
            const owner = await build('owner');
            expect((await send(owner, 'PUT', '/api/team/permission-templates/theirs', { name: 'Mine', baseRole: 'staff' })).status).toBe(404);
            expect((await send(owner, 'DELETE', '/api/team/permission-templates/theirs')).status).toBe(404);
            const row = await db.select().from(schema.permissionTemplates).where(eq(schema.permissionTemplates.id, 'theirs')).get();
            expect(row?.archivedAt).toBeNull();
        });

        it('a manager cannot create a template past their own permissions, and the refusal is recorded', async () => {
            const noFinance = await build('manager', { companyFinance: false });
            const refused = await create(noFinance, { name: 'Money', baseRole: 'staff', overrides: { companyFinance: true } });
            expect(refused.status).toBe(403);
            expect((await json<{ error: { code: string } }>(refused)).error.code).toBe('CAPABILITY_CEILING');
            expect((await db.select().from(schema.permissionTemplates).all())).toHaveLength(0);
            expect(await auditRows('user.grant_refused')).toHaveLength(1);
            // The same manager may save a template that stays within what they hold.
            expect((await create(noFinance, { name: 'Within', baseRole: 'staff', overrides: { companyFinance: false } })).status).toBe(201);
            // And an owner may save the template the manager could not.
            expect((await create(await build('owner'), { name: 'Money', baseRole: 'staff', overrides: { companyFinance: true } })).status).toBe(201);
        });

        it('rejects owner and agent as a base role', async () => {
            const owner = await build('owner');
            expect((await create(owner, { name: 'Boss', baseRole: 'owner' })).status).toBe(400);
            expect((await create(owner, { name: 'Ag', baseRole: 'agent' })).status).toBe(400);
        });
    });

    describe('POST /api/team/invite with templateId', () => {
        it('stores the role and switches the template resolves to', async () => {
            const res = await invite(await build('owner'), { templateId: 'inspector_trainee' });
            expect(res.status).toBe(201);
            const [row] = await invites();
            expect(row?.role).toBe('inspector');
            expect(row?.permissionOverrides).toEqual({
                publish: false, templateCreate: false, templateEdit: false, templateImport: false, deleteInspection: false,
            });
        });

        it('a company template works the same, and a template equal to its role stores nothing', async () => {
            const owner = await build('owner');
            const made = await json<{ data: Listed }>(await create(owner, { name: 'Billing', baseRole: 'staff', overrides: { companyFinance: true } }));
            await invite(owner, { templateId: made.data.id });
            await invite(owner, { email: 'b@a.test', templateId: 'inspector_standard' });
            const rows = await invites();
            expect(rows.find((r) => r.email === 'new@a.test')).toMatchObject({ role: 'staff', permissionOverrides: { companyFinance: true } });
            expect(rows.find((r) => r.email === 'b@a.test')).toMatchObject({ role: 'inspector', permissionOverrides: null });
        });

        it('switches sent with a template are applied on top of it', async () => {
            const res = await invite(await build('owner'), { templateId: 'inspector_trainee', permissionOverrides: { publish: true, scheduleOthers: true } });
            expect(res.status).toBe(201);
            const [row] = await invites();
            // publish is back to the role default, so it is not stored; the rest of the template stays.
            expect(row?.permissionOverrides).toEqual({
                scheduleOthers: true, templateCreate: false, templateEdit: false, templateImport: false, deleteInspection: false,
            });
        });

        it('a role that contradicts the template is a 400 and writes nothing; the same role is fine', async () => {
            const owner = await build('owner');
            const bad = await invite(owner, { templateId: 'inspector_trainee', role: 'manager' });
            expect(bad.status).toBe(400);
            expect(await invites()).toHaveLength(0);
            expect((await invite(owner, { templateId: 'inspector_trainee', role: 'inspector' })).status).toBe(201);
        });

        it('an unknown template, and another company\'s template, are 404', async () => {
            await db.insert(schema.permissionTemplates).values({
                id: 'theirs', tenantId: OTHER_TENANT, name: 'Theirs', baseRole: 'staff', overrides: {}, createdAt: new Date(), updatedAt: new Date(),
            });
            const owner = await build('owner');
            expect((await invite(owner, { templateId: 'nope' })).status).toBe(404);
            expect((await invite(owner, { templateId: 'theirs' })).status).toBe(404);
            expect(await invites()).toHaveLength(0);
        });

        it('the grant ceiling applies to what the template carries', async () => {
            const noFinance = await build('manager', { companyFinance: false });
            // The manager role carries company finance, which this manager lacks.
            const refused = await invite(noFinance, { templateId: 'manager_standard' });
            expect(refused.status).toBe(403);
            expect(await invites()).toHaveLength(0);
            // A template that stays within what the manager holds is fine.
            expect((await invite(noFinance, { templateId: 'inspector_trainee' })).status).toBe(201);
            // And an owner may use the one the manager could not.
            expect((await invite(await build('owner'), { email: 'm@a.test', templateId: 'manager_standard' })).status).toBe(201);
        });

        it('records which template was used, and no email', async () => {
            await invite(await build('owner'), { templateId: 'inspector_trainee' });
            const rows = await auditRows('user.invite');
            expect(rows).toHaveLength(1);
            expect(rows[0]?.metadata).toMatchObject({ role: 'inspector', templateKey: 'inspector_trainee' });
            expect(JSON.stringify(rows[0]?.metadata)).not.toContain('new@a.test');
        });

        it('without a template and without a role, the invite is an inspector as before', async () => {
            expect((await invite(await build('owner'), {})).status).toBe(201);
            expect((await invites())[0]).toMatchObject({ role: 'inspector', permissionOverrides: null });
        });
    });

    describe('PATCH /api/team/members/{id} with templateId', () => {
        it('copies the template onto the member and records which one', async () => {
            const res = await send(await build('owner'), 'PATCH', `/api/team/members/${INSPECTOR}`, { templateId: 'inspector_trainee' });
            expect(res.status).toBe(200);
            expect((await userRow(INSPECTOR))?.permissionOverrides).toMatchObject({ publish: false, deleteInspection: false });
            const rows = await auditRows('user.update');
            expect(rows[0]?.metadata).toMatchObject({ templateKey: 'inspector_trainee' });
        });

        it('later changes to a company template do not reach a member who already received it', async () => {
            const owner = await build('owner');
            const made = await json<{ data: Listed }>(await create(owner, { name: 'Helper', baseRole: 'inspector', overrides: { publish: false } }));
            await send(owner, 'PATCH', `/api/team/members/${INSPECTOR}`, { templateId: made.data.id });
            expect((await userRow(INSPECTOR))?.permissionOverrides).toEqual({ publish: false });

            await send(owner, 'PUT', `/api/team/permission-templates/${made.data.id}`, { name: 'Helper', baseRole: 'inspector', overrides: { publish: false, deleteInspection: false } });
            expect((await userRow(INSPECTOR))?.permissionOverrides).toEqual({ publish: false });
            await send(owner, 'DELETE', `/api/team/permission-templates/${made.data.id}`);
            expect((await userRow(INSPECTOR))?.permissionOverrides).toEqual({ publish: false });
            expect((await userRow(INSPECTOR))?.role).toBe('inspector');
        });

        it('a template that moves the member to another role changes the role, subject to the ceiling', async () => {
            const noFinance = await build('manager', { companyFinance: false });
            expect((await send(noFinance, 'PATCH', `/api/team/members/${INSPECTOR}`, { templateId: 'manager_standard' })).status).toBe(403);
            expect((await userRow(INSPECTOR))?.role).toBe('inspector');
            const owner = await build('owner');
            expect((await send(owner, 'PATCH', `/api/team/members/${INSPECTOR}`, { templateId: 'office_scheduler' })).status).toBe(200);
            expect((await userRow(INSPECTOR))?.role).toBe('staff');
        });

        describe('which inspections the member sees, stated beside a template', () => {
            // The edit drawer applies a template it still shows exactly AND states the scope beside it. Choosing
            // "all inspections" is the role's own default, so it diffs to nothing; it must still LIFT a stored
            // restriction rather than be mistaken for "no statement" and leave the member restricted.
            const restricted = () => db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, INSPECTOR));
            const patch = async (body: Record<string, unknown>) => send(await build('owner'), 'PATCH', `/api/team/members/${INSPECTOR}`, body);

            it('"all inspections" beside a template lifts a stored restriction', async () => {
                await restricted();
                const res = await patch({ templateId: 'inspector_standard', permissionOverrides: { viewAllInspections: true } });
                expect(res.status).toBe(200);
                expect((await userRow(INSPECTOR))?.permissionOverrides).toBeNull();
            });

            it('"only assigned" beside a template sets the restriction', async () => {
                const res = await patch({ templateId: 'inspector_standard', permissionOverrides: { viewAllInspections: false } });
                expect(res.status).toBe(200);
                expect((await userRow(INSPECTOR))?.permissionOverrides).toEqual({ viewAllInspections: false });
            });

            it('control: a template with no statement about scope leaves a stored restriction alone', async () => {
                await restricted();
                expect((await patch({ templateId: 'inspector_standard' })).status).toBe(200);
                expect((await userRow(INSPECTOR))?.permissionOverrides).toEqual({ viewAllInspections: false });
            });

            it('a manager within the grant ceiling can lift it beside a template', async () => {
                await restricted();
                const res = await send(await build('manager'), 'PATCH', `/api/team/members/${INSPECTOR}`, { templateId: 'inspector_standard', permissionOverrides: { viewAllInspections: true } });
                expect(res.status).toBe(200);
                expect((await userRow(INSPECTOR))?.permissionOverrides).toBeNull();
            });

            it('an explicit false beside a template for a role that always sees everything stores nothing', async () => {
                const res = await patch({ templateId: 'office_scheduler', permissionOverrides: { viewAllInspections: false } });
                expect(res.status).toBe(200);
                const row = await userRow(INSPECTOR);
                expect(row?.role).toBe('staff');
                expect(row?.permissionOverrides ?? null).toBeNull();
            });

            it('control: the same statement without a template lifts it too (the path that already worked)', async () => {
                await restricted();
                expect((await patch({ role: 'inspector', permissionOverrides: { viewAllInspections: true } })).status).toBe(200);
                expect((await userRow(INSPECTOR))?.permissionOverrides).toBeNull();
            });
        });

        it('an unknown template is a 404 and leaves the member alone', async () => {
            const res = await send(await build('owner'), 'PATCH', `/api/team/members/${INSPECTOR}`, { templateId: 'nope' });
            expect(res.status).toBe(404);
            expect((await userRow(INSPECTOR))?.permissionOverrides).toBeNull();
        });
    });
});
