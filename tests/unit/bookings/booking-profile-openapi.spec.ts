/**
 * GET /api/public/book/{tenant} and GET /api/public/book/{tenant}/{slug} are OpenAPI routes of the booking profile
 * router. The company read is covered in depth by bookings-company-endpoints.spec.ts; this file pins what the
 * conversion adds: the not-found bodies of both reads, the diagnostic a closed company page carries, the slug read's
 * two-part open test, and that the pair is documented as public operations MCP never offers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { tenants, users, availability, tenantConfigs } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(undefined) }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000a1';
const SLUG = 'acme-profile';
const ENV = { DB: {}, TURNSTILE_SITE_KEY: 'site-key' } as HonoConfig['Bindings'];

describe('booking profile reads served through OpenAPI routes', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    // No session variable is set: both reads are public.
    function buildApp(qualified: string[] = []) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            const booking = { getQualifiedInspectorIds: vi.fn().mockResolvedValue(qualified) };
            c.set('services', { booking } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/', bookingsRoutes);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        return app;
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(tenants).values({
            id: TENANT_ID, slug: SLUG, tier: 'free', status: 'active', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
        } as never);
        await db.insert(tenantConfigs).values({
            tenantId: TENANT_ID, companyName: 'Acme Profile', updatedAt: new Date(), defaultTimezone: 'America/New_York',
        } as never);
        await db.insert(users).values({
            id: 'u-jo', tenantId: TENANT_ID, email: 'jo@x.com', passwordHash: 'h', role: 'inspector', name: 'Jo', slug: 'jo', createdAt: new Date(),
        } as never);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    describe('GET /book/{tenant}', () => {
        it('names the missing half when booking is closed: no hours for any inspector', async () => {
            const res = await buildApp([]).request(`/book/${SLUG}`, {}, ENV);
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { bookingOpen: boolean; bookingClosedReason: string | null; currency: string; depositPolicy: unknown } };
            expect(body.data.bookingOpen).toBe(false);
            expect(body.data.bookingClosedReason).toBe('no_inspector_hours');
            expect(body.data.currency).toBe('USD');
            expect(body.data.depositPolicy).toBeNull();
        });

        it('reports a null closed reason while booking is open', async () => {
            await db.insert(availability).values({
                id: 'av-jo', tenantId: TENANT_ID, inspectorId: 'u-jo', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', createdAt: new Date(),
            } as never);
            const res = await buildApp(['u-jo']).request(`/book/${SLUG}`, {}, ENV);
            const body = await res.json() as { data: { bookingOpen: boolean; bookingClosedReason: string | null } };
            expect(body.data.bookingOpen).toBe(true);
            expect(body.data.bookingClosedReason).toBeNull();
        });

        it('answers 404 with the not_found body for an unknown company', async () => {
            const res = await buildApp().request('/book/nobody-here', {}, ENV);
            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({ success: false, error: { code: 'not_found', message: 'Tenant not found' } });
        });
    });

    describe('GET /book/{tenant}/{slug}', () => {
        it('returns the inspector profile for a known company and slug, with the open test unmet without hours', async () => {
            const res = await buildApp().request(`/book/${SLUG}/jo`, {}, ENV);
            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: Record<string, unknown> };
            expect(body.success).toBe(true);
            expect(body.data).toMatchObject({
                inspectorId: 'u-jo', name: 'Jo', company: 'Acme Profile', avatar: null, turnstileSiteKey: 'site-key', bookingOpen: false, services: [],
            });
        });

        it('opens once the inspector has hours and the company declared a zone', async () => {
            await db.insert(availability).values({
                id: 'av-jo2', tenantId: TENANT_ID, inspectorId: 'u-jo', dayOfWeek: 2, startTime: '09:00', endTime: '17:00', createdAt: new Date(),
            } as never);
            const body = await (await buildApp().request(`/book/${SLUG}/jo`, {}, ENV)).json() as { data: { bookingOpen: boolean } };
            expect(body.data.bookingOpen).toBe(true);
        });

        it('answers 404 with the Inspector not found body for an unknown slug', async () => {
            const res = await buildApp().request(`/book/${SLUG}/nobody`, {}, ENV);
            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({ success: false, error: { code: 'not_found', message: 'Inspector not found' } });
        });

        it('answers 404 with the Tenant not found body for an unknown company', async () => {
            const res = await buildApp().request('/book/nobody-here/jo', {}, ENV);
            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({ success: false, error: { code: 'not_found', message: 'Tenant not found' } });
        });
    });

    it('documents both reads as public operations that MCP never offers', () => {
        const doc = buildOpenApiDocument(buildApp(), { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const company = doc.paths?.['/book/{tenant}']?.get as Record<string, unknown> | undefined;
        const inspector = doc.paths?.['/book/{tenant}/{slug}']?.get as Record<string, unknown> | undefined;
        expect(company?.operationId).toBe('getCompanyBookingProfile');
        expect(inspector?.operationId).toBe('getInspectorBookingProfile');
        for (const op of [company, inspector]) {
            expect(op?.['x-scopes']).toEqual([]);
            expect(op?.['x-tier']).toBe('excluded');
        }
    });
});
