import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { TenantConfigPatchSchema } from '../../../server/lib/validations/admin/settings';
import { WRITABLE_TENANT_CONFIG_COLUMNS } from '../../../server/lib/tenant-config-write-policy';
import * as schema from '../../../server/lib/db/schema';
import adminRoutes from '../../../server/api/admin';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import { TENANT_CONFIGS_TEST_DDL } from '../../helpers/inline-ddl';

describe('offlineMaxDays tenant setting', () => {
    it('accepts 1..365', () => {
        expect(TenantConfigPatchSchema.safeParse({ offlineMaxDays: 1 }).success).toBe(true);
        expect(TenantConfigPatchSchema.safeParse({ offlineMaxDays: 365 }).success).toBe(true);
    });
    it('rejects 0, 366 and non-integers', () => {
        expect(TenantConfigPatchSchema.safeParse({ offlineMaxDays: 0 }).success).toBe(false);
        expect(TenantConfigPatchSchema.safeParse({ offlineMaxDays: 366 }).success).toBe(false);
        expect(TenantConfigPatchSchema.safeParse({ offlineMaxDays: 1.5 }).success).toBe(false);
    });
    it('leaves the key absent when not sent (PATCH must not reset it)', () => {
        const out = TenantConfigPatchSchema.parse({});
        expect('offlineMaxDays' in out).toBe(false);
    });
    it('is a writable tenant_configs column', () => {
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('offlineMaxDays')).toBe(true);
    });
});

describe('offline_max_days column default', () => {
    it('defaults to 30 in the migrated schema', async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        await fixture.db.insert(schema.tenants).values({
            id: 'omd-t1', slug: 'omd', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await fixture.db.insert(schema.tenantConfigs).values({ tenantId: 'omd-t1', updatedAt: new Date() });
        const row = await fixture.db.select({ v: schema.tenantConfigs.offlineMaxDays })
            .from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, 'omd-t1')).get();
        expect(row?.v).toBe(30);
    });

    it('defaults to 30 in the workers inline DDL', () => {
        const sqlite = new Database(':memory:');
        sqlite.exec(TENANT_CONFIGS_TEST_DDL);
        sqlite.prepare('INSERT INTO tenant_configs (tenant_id, updated_at) VALUES (?, ?)').run('t1', 1);
        const row = sqlite.prepare('SELECT offline_max_days AS v FROM tenant_configs').get() as { v: number };
        expect(row.v).toBe(30);
    });
});

describe('/api/admin/tenant-config offlineMaxDays', () => {
    function buildApp(services: Record<string, unknown>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', 't1');
            c.set('services', services as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        return { app, env: { JWT_SECRET: 'x' } };
    }
    function patch(app: OpenAPIHono<HonoConfig>, env: object, body: unknown) {
        return app.request('/api/admin/tenant-config', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }, env);
    }

    it('GET reports 30 when the config has no value, and passes a stored value through', async () => {
        const first = buildApp({ branding: { getBranding: async () => ({}) } });
        const a = await (await first.app.request('/api/admin/tenant-config', {}, first.env)).json() as { data: { offlineMaxDays: number } };
        expect(a.data.offlineMaxDays).toBe(30);
        const second = buildApp({ branding: { getBranding: async () => ({ offlineMaxDays: 45 }) } });
        const b = await (await second.app.request('/api/admin/tenant-config', {}, second.env)).json() as { data: { offlineMaxDays: number } };
        expect(b.data.offlineMaxDays).toBe(45);
    });

    it('PATCH writes offlineMaxDays, and omits it when not sent', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ branding: { updateBranding, getBranding: async () => ({}) } });
        const ok = await patch(app, env, { offlineMaxDays: 45 });
        expect(ok.status).toBe(200);
        expect(updateBranding).toHaveBeenCalledWith('t1', expect.objectContaining({ offlineMaxDays: 45 }));

        updateBranding.mockClear();
        const other = await patch(app, env, { allowInspectorChoice: true });
        expect(other.status).toBe(200);
        const written = updateBranding.mock.calls[0]?.[1] as Record<string, unknown>;
        expect('offlineMaxDays' in written).toBe(false);
    });

    it('PATCH rejects out-of-range values without writing', async () => {
        const updateBranding = vi.fn().mockResolvedValue(undefined);
        const { app, env } = buildApp({ branding: { updateBranding, getBranding: async () => ({}) } });
        expect((await patch(app, env, { offlineMaxDays: 0 })).status).toBe(400);
        expect((await patch(app, env, { offlineMaxDays: 366 })).status).toBe(400);
        expect(updateBranding).not.toHaveBeenCalled();
    });
});
