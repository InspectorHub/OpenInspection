/**
 * The company-level team defaults, including whether an inspector invited from now on starts able to
 * see every inspection (`newInspectorsViewAll`). The default is stored on `tenant_configs`, read when an
 * invite is created, and never applied retroactively.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { BrandingService } from '../../../server/services/branding.service';
import teamDefaultsRoutes from '../../../server/api/team-defaults';
import { WRITABLE_TENANT_CONFIG_COLUMNS } from '../../../server/lib/tenant-config-write-policy';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = 'td-tenant';

describe('/api/team/defaults', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'td', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    });

    function build(role: 'owner' | 'manager' | 'inspector') {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('tenantId', TENANT);
            c.set('user', { sub: 'u', role, tenantId: TENANT } as never);
            c.set('services', { branding: new BrandingService({} as D1Database) } as never);
            await next();
        });
        app.route('/api/team', teamDefaultsRoutes);
        return app;
    }
    const get = async (role: 'owner' | 'manager' | 'inspector' = 'owner') => {
        const res = await build(role).request('/api/team/defaults', {}, { DB: {} } as never);
        return { status: res.status, data: (await res.json() as { data: Record<string, unknown> }).data };
    };
    const put = (role: 'owner' | 'manager' | 'inspector', body: unknown) =>
        build(role).request('/api/team/defaults', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        }, { DB: {} } as never);
    const stored = () => db.select().from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT)).get();

    it('reports the defaults when the company has no config row yet: new inspectors can see everything', async () => {
        expect(await get()).toEqual({ status: 200, data: { teamModeDefault: false, newInspectorsViewAll: true } });
    });
    it('a config row created for another reason carries the same defaults', async () => {
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
        expect((await get()).data).toEqual({ teamModeDefault: false, newInspectorsViewAll: true });
    });
    it('writes the new default and reads it back, leaving the other toggle where it was', async () => {
        expect((await put('owner', { teamModeDefault: true })).status).toBe(200);
        expect((await put('owner', { newInspectorsViewAll: false })).status).toBe(200);
        expect((await get()).data).toEqual({ teamModeDefault: true, newInspectorsViewAll: false });
        expect((await stored())?.newInspectorsViewAll).toBe(false);
    });
    it('an empty body changes nothing', async () => {
        await put('owner', { newInspectorsViewAll: false });
        expect((await put('manager', {})).status).toBe(200);
        expect((await get()).data.newInspectorsViewAll).toBe(false);
    });
    it('a manager may change it; an inspector may read it but not change it', async () => {
        expect((await put('manager', { newInspectorsViewAll: false })).status).toBe(200);
        expect((await get('inspector')).status).toBe(200);
        const refused = await put('inspector', { newInspectorsViewAll: true });
        expect(refused.status).toBe(403);
        expect((await get()).data.newInspectorsViewAll).toBe(false);
    });
    it('rejects a value that is not a boolean', async () => {
        expect((await put('owner', { newInspectorsViewAll: 'no' })).status).toBe(400);
    });
    it('the column is on the tenant-config write allowlist, derived from the request schema', () => {
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('newInspectorsViewAll')).toBe(true);
    });
});
