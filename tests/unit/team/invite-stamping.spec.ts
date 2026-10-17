/**
 * The company default for new inspectors, applied when an invite is created.
 *
 * Every assertion reads the stored `tenant_invites.permission_overrides`, because that is what a
 * member later inherits. The default is stamped only when the request says nothing about the scope,
 * an explicit `true` beats a default of `false`, and changing the default never reaches an invite or
 * a member that already exists.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { buildTeamApp, TEAM_ENV } from '../helpers/team-routes-harness';
import { seedVisibilityFixture, TENANT, USERS } from '../helpers/visibility-fixture';
import { withNewInspectorDefault, inspectionScopeOf } from '../../../server/lib/team/new-inspector-default';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const RESTRICTED = { viewAllInspections: false };

describe('inviting an inspector under the company default', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let seq = 0;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seedVisibilityFixture(db);
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
    });

    const { ctx, settle } = makeExecutionContext();
    const owner = (): OpenAPIHono<HonoConfig> => buildTeamApp(db, TENANT, USERS.owner, 'owner');
    const setDefault = (viewsAll: boolean) =>
        db.update(schema.tenantConfigs).set({ newInspectorsViewAll: viewsAll }).where(eq(schema.tenantConfigs.tenantId, TENANT));
    async function invite(body: Record<string, unknown>): Promise<{ status: number; stored: unknown; email: string }> {
        const email = `invitee-${++seq}@a.test`;
        const res = await owner().request('/api/team/invite', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, notify: false, ...body }),
        }, TEAM_ENV, ctx);
        const row = await db.select().from(schema.tenantInvites).where(eq(schema.tenantInvites.email, email)).get();
        return { status: res.status, stored: row?.permissionOverrides ?? null, email };
    }

    it('default on and the request silent: nothing is stored, byte for byte what an invite stored before', async () => {
        await setDefault(true);
        expect(await invite({ role: 'inspector' })).toMatchObject({ status: 201, stored: null });
    });
    it('a company with no config row behaves as default on', async () => {
        await db.delete(schema.tenantConfigs);
        expect(await invite({ role: 'inspector' })).toMatchObject({ status: 201, stored: null });
    });
    it('default off and the request silent: the restriction is stamped onto the invite', async () => {
        await setDefault(false);
        expect(await invite({ role: 'inspector' })).toMatchObject({ status: 201, stored: RESTRICTED });
    });
    it('default off, and the role defaults to inspector when none is sent', async () => {
        await setDefault(false);
        expect(await invite({})).toMatchObject({ status: 201, stored: RESTRICTED });
    });
    it('default off and an explicit true: the explicit value wins, so nothing is stored', async () => {
        await setDefault(false);
        expect(await invite({ role: 'inspector', permissionOverrides: { viewAllInspections: true } })).toMatchObject({ status: 201, stored: null });
    });
    it('default off and an explicit false: stored as sent', async () => {
        await setDefault(false);
        expect(await invite({ role: 'inspector', permissionOverrides: RESTRICTED })).toMatchObject({ status: 201, stored: RESTRICTED });
    });
    it('default off keeps the switches that were sent beside the stamp', async () => {
        await setDefault(false);
        expect(await invite({ role: 'inspector', permissionOverrides: { publish: false } }))
            .toMatchObject({ status: 201, stored: { publish: false, viewAllInspections: false } });
    });
    it('default off does not touch a manager or staff invite: those roles pin the scope', async () => {
        await setDefault(false);
        expect(await invite({ role: 'manager' })).toMatchObject({ status: 201, stored: null });
        expect(await invite({ role: 'staff' })).toMatchObject({ status: 201, stored: null });
    });
    it('default off and a permission template that does not mention the scope: the stamp applies', async () => {
        await setDefault(false);
        expect(await invite({ templateId: 'inspector_standard' })).toMatchObject({ status: 201, stored: RESTRICTED });
    });
    it('default off, a template, and an explicit true beside it: the explicit value wins', async () => {
        await setDefault(false);
        expect(await invite({ templateId: 'inspector_standard', permissionOverrides: { viewAllInspections: true } }))
            .toMatchObject({ status: 201, stored: null });
    });
    it('changing the default is not retroactive: an invite already made keeps what it was stamped with', async () => {
        await setDefault(false);
        const restricted = await invite({ role: 'inspector' });
        await setDefault(true);
        const open = await invite({ role: 'inspector' });
        await setDefault(false);
        const rows = await db.select().from(schema.tenantInvites).all();
        expect(rows.find((r) => r.email === restricted.email)?.permissionOverrides).toEqual(RESTRICTED);
        expect(rows.find((r) => r.email === open.email)?.permissionOverrides ?? null).toBeNull();
    });
    it('changing the default never reaches an existing member', async () => {
        await db.update(schema.users).set({ permissionOverrides: null }).where(eq(schema.users.id, USERS.inspAll));
        await setDefault(false);
        const row = await db.select({ o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, USERS.inspAll)).get();
        expect(row?.o ?? null).toBeNull();
    });
    it('the invite is audited with the scope it grants, and no address', async () => {
        await setDefault(false);
        await invite({ role: 'inspector' });
        await invite({ role: 'inspector', permissionOverrides: { viewAllInspections: true } });
        await settle();
        const rows = (await db.select().from(schema.auditLogs).all()).filter((r) => r.action === 'user.invite');
        expect(rows.map((r) => (r.metadata as { inspectionScope?: string }).inspectionScope).sort()).toEqual(['all', 'assigned']);
        expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('@');
    });
});

describe('withNewInspectorDefault', () => {
    const base = { role: 'inspector' as const, requested: undefined, template: null, companyViewsAll: false };
    it('stamps only an inspector invite that says nothing, under a default of off', () => {
        expect(withNewInspectorDefault(base)).toEqual(RESTRICTED);
        expect(withNewInspectorDefault({ ...base, companyViewsAll: true })).toBeUndefined();
        expect(withNewInspectorDefault({ ...base, role: 'manager' })).toBeUndefined();
    });
    it('leaves a stated value or a template that states one alone', () => {
        expect(withNewInspectorDefault({ ...base, requested: { viewAllInspections: true } })).toEqual({ viewAllInspections: true });
        expect(withNewInspectorDefault({ ...base, template: { viewAllInspections: false } })).toBeUndefined();
    });
    it('names the granted scope', () => {
        expect(inspectionScopeOf('inspector', RESTRICTED)).toBe('assigned');
        expect(inspectionScopeOf('inspector', null)).toBe('all');
        expect(inspectionScopeOf('manager', RESTRICTED)).toBe('all');
    });
});
