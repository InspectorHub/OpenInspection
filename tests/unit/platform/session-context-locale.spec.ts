/**
 * session-context locale/currency resolution — unit tests.
 *
 * Verifies GET /api/session/context exposes the tenant default locale/currency
 * and the per-user locale override, so the client display-locale hook can
 * resolve the effective viewer locale. Mirrors session-context-collab.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import routes AFTER mock is wired.
import sessionContextRoutes from '../../../server/api/session-context';

const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
const USER_ID = 'u-locale';

let testDb: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
});

async function seedTenant() {
    await testDb.insert(schema.tenants).values({
        id: TENANT_ID,
        name: 'Locale Test Co',
        slug: 'locale-test-co',
        tier: 'free',
        status: 'active',
        deploymentMode: 'shared',
        createdAt: new Date(),
    });
}

async function seedConfig(defaultLocale: string, currency: string) {
    await testDb.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        defaultLocale,
        currency,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.tenantConfigs.tenantId,
        set: { defaultLocale, currency, updatedAt: new Date() },
    });
}

async function seedUser(locale: string | null) {
    await testDb.insert(schema.users).values({
        id: USER_ID,
        tenantId: TENANT_ID,
        email: 'u@locale.com',
        name: 'Locale User',
        passwordHash: 'h',
        role: 'owner',
        locale,
        createdAt: new Date(),
    });
}

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: USER_ID, role: 'owner' } as never);
        c.set('tenantId', TENANT_ID);
        c.set('branding', {
            companyName: 'Test',
            primaryColor: '#000',
            logoUrl: null,
            defaultProfileId: 'signature',
            isSaas: false,
            portalBaseUrl: null,
            tenantSlug: 'locale-test-co',
            tenantStatus: 'active',
            currentUserSlug: null,
            bookingHost: null,
        } as never);
        c.set('profile', { mode: 'standalone', hasBilling: false, hasSeatQuota: false } as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = { APP_MODE: 'standalone', DB: {} as D1Database };
        await next();
    });
    app.route('/api/session', sessionContextRoutes);
    return app;
}

type Body = {
    data: {
        branding: { defaultLocale: string; currency: string };
        user: { locale: string | null };
    };
};

describe('session-context locale/currency resolution', () => {
    it('exposes tenant default locale/currency and a null user override', async () => {
        await seedTenant();
        await seedConfig('es-419', 'USD');
        await seedUser(null);

        const res = await buildApp().request('/api/session/context');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Body;
        expect(body.data.branding.defaultLocale).toBe('es-419');
        expect(body.data.branding.currency).toBe('USD');
        expect(body.data.user.locale).toBeNull();
    });

    it('exposes the per-user locale override when set', async () => {
        await seedTenant();
        await seedConfig('en-US', 'USD');
        await seedUser('es-419');

        const res = await buildApp().request('/api/session/context');
        const body = (await res.json()) as Body;
        expect(body.data.branding.defaultLocale).toBe('en-US');
        expect(body.data.user.locale).toBe('es-419');
    });

    it('falls back to en-US/USD when no tenant_configs row exists', async () => {
        await seedTenant();
        await seedUser(null);

        const res = await buildApp().request('/api/session/context');
        const body = (await res.json()) as Body;
        expect(body.data.branding.defaultLocale).toBe('en-US');
        expect(body.data.branding.currency).toBe('USD');
    });
});
