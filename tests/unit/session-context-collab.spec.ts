/**
 * session-context collabEditing resolution — unit tests.
 *
 * Verifies that GET /api/session/context resolves `collabEditing` correctly:
 * - false when the tenant has no tenant_configs row
 * - false when the column is 0 (the stored default)
 * - true when the column is explicitly set to 1
 *
 * Mirrors the structure of session-context-video.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../server/types/hono';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import routes AFTER mock is wired.
import sessionContextRoutes from '../../server/api/session-context';

// ── constants ─────────────────────────────────────────────────────────────────
const TENANT_ID = '00000000-0000-0000-0000-000000000181';

// ── DB ────────────────────────────────────────────────────────────────────────
let testDb: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
});

// ── seed helpers ──────────────────────────────────────────────────────────────
async function seedTenant() {
    await testDb.insert(schema.tenants).values({
        id: TENANT_ID,
        name: 'Collab Test Co',
        slug: 'collab-test-co',
        tier: 'free',
        status: 'active',
        deploymentMode: 'shared',
        createdAt: new Date(),
    });
}

async function seedCollabEditing(value: boolean) {
    await testDb.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        collabEditing: value,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.tenantConfigs.tenantId,
        set: { collabEditing: value, updatedAt: new Date() },
    });
}

// ── minimal Hono app stub ─────────────────────────────────────────────────────
function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();

    app.use('*', async (c, next) => {
        c.set('user', { sub: 'u-test', role: 'admin' } as never);
        c.set('tenantId', TENANT_ID);
        c.set('branding', {
            companyName: 'Test',
            primaryColor: '#000',
            logoUrl: null,
            reportTheme: 'modern',
            isSaas: false,
            portalBaseUrl: null,
            tenantSlug: 'collab-test-co',
            tenantStatus: 'active',
            currentUserSlug: null,
            bookingHost: null,
        } as never);
        c.set('profile', { mode: 'standalone', hasBilling: false, hasSeatQuota: false } as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = {
            APP_MODE: 'standalone',
            DB: {} as D1Database,
        };
        await next();
    });

    app.route('/api/session', sessionContextRoutes);
    return app;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('session-context collabEditing resolution', () => {
    it('no tenant_configs row → collabEditing=false (default off)', async () => {
        await seedTenant();
        // No tenantConfigs row seeded — row will be null.

        const res = await buildApp().request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { collabEditing: boolean } };
        expect(body.data.collabEditing).toBe(false);
    });

    it('collabEditing=false in DB → collabEditing=false', async () => {
        await seedTenant();
        await seedCollabEditing(false);

        const res = await buildApp().request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { collabEditing: boolean } };
        expect(body.data.collabEditing).toBe(false);
    });

    it('collabEditing=true in DB → collabEditing=true', async () => {
        await seedTenant();
        await seedCollabEditing(true);

        const res = await buildApp().request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { collabEditing: boolean } };
        expect(body.data.collabEditing).toBe(true);
    });
});
