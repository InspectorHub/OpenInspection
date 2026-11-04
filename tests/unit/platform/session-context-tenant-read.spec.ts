/**
 * The session context needs the tenant row for two answers on the saas
 * profile: the video provider (plan tier and status) and the cooling-window
 * anchor (created-at). It reads that primary-key row ONCE and shares it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { d1For } from '../helpers/d1-binding';
import sessionContextRoutes from '../../../server/api/session-context';

const TENANT_ID = '00000000-0000-0000-0000-000000000078';
let testDb: BetterSQLite3Database<typeof schema>;
let tenantReads = 0;
let binding: D1Database;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    tenantReads = 0;
    // Count the statements that read the tenants table: the binding sees every query the route sends.
    const real = d1For(testDb);
    binding = {
        prepare: (sql: string) => {
            if (/from "tenants"/i.test(sql)) tenantReads += 1;
            return real.prepare(sql);
        },
        batch: (list: never) => (real.batch as (l: never) => unknown)(list),
    } as unknown as D1Database;
    await testDb.insert(schema.tenants).values({ id: TENANT_ID, slug: 'co', tier: 'pro', status: 'active', deploymentMode: 'shared', createdAt: new Date() });
    await testDb.insert(schema.users).values({ id: 'u-1', tenantId: TENANT_ID, email: 'u@example.com', passwordHash: 'x', role: 'owner', createdAt: new Date() } as never);
});

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: 'u-1', role: 'owner' } as never);
        c.set('tenantId', TENANT_ID);
        c.set('branding', { tenantSlug: 'co' } as never);
        c.set('profile', { mode: 'saas', hasBilling: true, hasSeatQuota: false, videoBackendManaged: true } as never);
        c.set('services' as never, { message: { unreadCountForTenant: async () => 0 } } as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = { APP_MODE: 'saas', DB: binding, STREAM: {}, STREAM_CUSTOMER_SUBDOMAIN: 'cust' };
        await next();
    });
    app.route('/api/session', sessionContextRoutes);
    return app;
}

describe('session context tenant row', () => {
    it('is read once when both the video provider and the cooling window need it', async () => {
        const body = await (await buildApp().request('/api/session/context')).json() as { data: { videoProvider: string; outboundCoolingWindow: { unlockAtMs: number } | null } };
        expect(tenantReads).toBe(1);
        expect(body.data.videoProvider).toBe('stream');
        expect(body.data.outboundCoolingWindow).not.toBeNull();
    });
});
