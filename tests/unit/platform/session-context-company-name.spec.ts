/**
 * The company name and the region GET /api/session/context reports.
 *
 * ── Why the name is read from the row and not from `c.get('branding')` ───────
 * `brandingMiddleware` is mounted BEFORE `jwtAuthMiddleware`, so on a saas
 * authenticated request it has no `tenantId` and returns platform defaults —
 * its own header calls that "the common case in saas, not an edge case". Every
 * saas workspace was therefore told its company name was 'OpenInspection', no
 * matter what it had saved, which is why the Getting started checklist's first
 * step ("add your company name") could never be ticked: the checklist tests
 * `companyName !== 'OpenInspection'`.
 *
 * The test reproduces that shape directly — a `branding` carrying the platform
 * default next to a tenant_configs row carrying the real name — because that is
 * the shape production has, not a contrived one.
 *
 * `holidayRegion` rides along from the same row: it is the only structured
 * statement a workspace makes about where it works, and the New Inspection
 * template picker orders on it so a workspace is not offered another state's
 * statutory form first (`app/lib/template-order.ts`).
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

const TENANT_ID = '00000000-0000-0000-0000-0000000000bb';
const USER_ID = 'u-company-name';

let testDb: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
});

async function seedTenant() {
    await testDb.insert(schema.tenants).values({
        id: TENANT_ID, slug: 'acme-home-inspections', tier: 'free', status: 'active',
        deploymentMode: 'shared', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id: USER_ID, tenantId: TENANT_ID, email: 'u@acme.com', name: 'Owner',
        passwordHash: 'h', role: 'owner', createdAt: new Date(),
    });
}

async function seedConfig(values: { companyName?: string | null; holidayRegion?: string | null }) {
    await testDb.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        companyName: values.companyName ?? null,
        holidayRegion: values.holidayRegion ?? null,
        updatedAt: new Date(),
    });
}

/** `branding` carries the PLATFORM default, exactly as it does on saas. */
function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: USER_ID, role: 'owner' } as never);
        c.set('tenantId', TENANT_ID);
        c.set('branding', {
            companyName: 'OpenInspection',
            primaryColor: '#6366f1',
            logoUrl: null,
            defaultProfileId: 'signature',
            isSaas: true,
            portalBaseUrl: null,
            tenantSlug: 'acme-home-inspections',
            tenantStatus: 'active',
            currentUserSlug: null,
            bookingHost: null,
        } as never);
        c.set('profile', { mode: 'saas', hasBilling: true, hasSeatQuota: true } as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = { APP_MODE: 'saas', DB: {} as D1Database };
        await next();
    });
    app.route('/api/session', sessionContextRoutes);
    return app;
}

type Body = { data: { branding: { companyName: string; holidayRegion: string | null } } };

async function read() {
    const res = await buildApp().request('/api/session/context');
    expect(res.status).toBe(200);
    return (await res.json()) as Body;
}

describe('session-context company name', () => {
    it('reports the saved company name even though branding carries the platform default', async () => {
        await seedTenant();
        await seedConfig({ companyName: 'Acme Home Inspections' });

        const body = await read();
        expect(body.data.branding.companyName).toBe('Acme Home Inspections');
        // Discriminating: the old behaviour returned exactly this string.
        expect(body.data.branding.companyName).not.toBe('OpenInspection');
        // And never the slug — a slug is not a name a client should be shown.
        expect(body.data.branding.companyName).not.toBe('acme-home-inspections');
    });

    it('falls back to the platform name when the workspace genuinely has not set one', async () => {
        await seedTenant();
        await seedConfig({ companyName: null });

        // The positive control for the test above: the fix must not invent a
        // name out of the slug, or the checklist step would read as done for a
        // workspace that never completed it.
        expect((await read()).data.branding.companyName).toBe('OpenInspection');
    });

    it('treats a whitespace-only company name as unset', async () => {
        await seedTenant();
        await seedConfig({ companyName: '   ' });

        expect((await read()).data.branding.companyName).toBe('OpenInspection');
    });

    it('reports the workspace region, and null when it has not said', async () => {
        await seedTenant();
        await seedConfig({ companyName: 'Acme', holidayRegion: 'US-TX' });
        expect((await read()).data.branding.holidayRegion).toBe('US-TX');
    });

    it('reports a null region for a workspace with no config row at all', async () => {
        await seedTenant();
        expect((await read()).data.branding.holidayRegion).toBeNull();
        expect((await read()).data.branding.companyName).toBe('OpenInspection');
    });
});
