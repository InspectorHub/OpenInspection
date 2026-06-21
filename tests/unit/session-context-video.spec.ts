/**
 * session-context videoProvider resolution — unit tests.
 *
 * Verifies that the self-host branch of GET /api/session/context resolves
 * `videoProvider` correctly, specifically that 'stream' requires BOTH
 * videoMode='stream' in tenant_configs AND the STREAM binding to be present.
 *
 * This guards against the fail-open regression fixed in #171: when
 * videoMode='stream' but STREAM is absent the client must get 'r2' so it
 * renders the R2 path (with privacy checkbox), not the Stream UI that would
 * lead to a hard 503 on create-upload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../server/types/hono';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import routes AFTER mock is wired.
import sessionContextRoutes from '../../server/api/session-context';

// ── constants ─────────────────────────────────────────────────────────────────
const TENANT_ID = '00000000-0000-0000-0000-000000000099';

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
        name: 'Self-Host Co',
        slug: 'self-host-co',
        tier: 'free',
        status: 'active',
        deploymentMode: 'shared',
        createdAt: new Date(),
    });
}

async function seedVideoMode(videoMode: 'r2' | 'stream', streamCustomerSubdomain?: string) {
    // 'stream' resolves only when a non-empty subdomain is also configured
    // (mirrors resolveVideoBackend's fail-closed requirement); otherwise the
    // client must fall back to 'r2'.
    const integrationConfig = streamCustomerSubdomain
        ? JSON.stringify({ streamCustomerSubdomain })
        : null;
    await testDb.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        videoMode,
        integrationConfig,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.tenantConfigs.tenantId,
        set: { videoMode, integrationConfig, updatedAt: new Date() },
    });
}

// ── minimal Hono app stub ─────────────────────────────────────────────────────
function buildApp(hasStream: boolean) {
    const app = new OpenAPIHono<HonoConfig>();

    const stubStream = hasStream ? ({} as StreamBinding) : undefined;

    app.use('*', async (c, next) => {
        // Auth + tenant context (required by handler guard).
        c.set('user', { sub: 'u-test', role: 'admin' } as never);
        c.set('tenantId', TENANT_ID);
        // Branding stub — handler reads these defensively with || fallbacks.
        c.set('branding', {
            siteName: 'Test',
            primaryColor: '#000',
            logoUrl: null,
            reportTheme: 'modern',
            isSaas: false,
            portalBaseUrl: null,
            tenantSlug: 'self-host-co',
            tenantStatus: 'active',
            currentUserSlug: null,
            bookingHost: null,
        } as never);
        // Profile stub — hasSeatQuota: false skips the seat-usage DB call.
        c.set('profile', { mode: 'standalone', hasBilling: false, hasSeatQuota: false } as never);
        // Env bindings.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = {
            APP_MODE: 'standalone',
            DB: {} as D1Database,
            STREAM: stubStream,
        };
        await next();
    });

    app.route('/api/session', sessionContextRoutes);
    return app;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('session-context videoProvider — self-host resolution', () => {
    it('videoMode=stream + STREAM binding + subdomain → videoProvider=stream', async () => {
        await seedTenant();
        await seedVideoMode('stream', 'customer-abc');

        const res = await buildApp(true).request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { videoProvider: string } };
        expect(body.data.videoProvider).toBe('stream');
    });

    it('videoMode=stream + STREAM binding present but NO subdomain → videoProvider=r2 (fail-safe; resolver would 503)', async () => {
        await seedTenant();
        await seedVideoMode('stream'); // no subdomain configured

        const res = await buildApp(true).request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { videoProvider: string } };
        expect(body.data.videoProvider).toBe('r2');
    });

    it('videoMode=stream + NO STREAM binding → videoProvider=r2 (fail-safe)', async () => {
        await seedTenant();
        await seedVideoMode('stream', 'customer-abc'); // subdomain set; binding is the sole missing piece

        const res = await buildApp(false).request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { videoProvider: string } };
        expect(body.data.videoProvider).toBe('r2');
    });

    it('videoMode=r2 (default) + STREAM binding present → videoProvider=r2', async () => {
        await seedTenant();
        await seedVideoMode('r2');

        const res = await buildApp(true).request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { videoProvider: string } };
        expect(body.data.videoProvider).toBe('r2');
    });

    it('no tenant_configs row → videoProvider=r2 (defaults to r2)', async () => {
        await seedTenant();
        // No tenantConfigs row seeded — cfgRow will be null.

        const res = await buildApp(true).request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { videoProvider: string } };
        expect(body.data.videoProvider).toBe('r2');
    });
});
