import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalService } from '../../../server/services/portal.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// PortalService builds its drizzle handle via `drizzle(this.db)` (drizzle-orm/d1).
// Mock that factory to hand back the in-memory better-sqlite3 test DB, mirroring
// the harness used by portal-access.spec.ts.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { TENANT, inspStub } from '../helpers/portal-routes-setup';

// ---------------------------------------------------------------------------
// Task 3 — portal API routes + session middleware
// ---------------------------------------------------------------------------
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { signPortalSession, signMagicLink } from '../../../server/lib/portal-session';
// eslint-disable-next-line import/order
import portalRoutes from '../../../server/api/portal';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const SECRET = 'test-jwt-secret';

describe('portal API', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sendEmail: ReturnType<typeof vi.fn>;

    async function seedInspection(id: string, overrides: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await testDb.insert(schema.inspections).values({
            id,
            tenantId: TENANT,
            propertyAddress: `${id} Main St`,
            date: '2026-06-01',
            status: 'requested',
            reportStatus: 'in_progress',
            paymentStatus: 'unpaid',
            createdAt: new Date(),
            ...overrides,
        });
    }

    async function seedToken(inspectionId: string, recipientEmail: string, role: 'client' | 'co_client' | 'agent' = 'client', revokedAt: number | null = null) {
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(),
            tenantId: TENANT,
            inspectionId,
            recipientEmail,
            role,
            token: crypto.randomUUID(),
            createdAt: new Date(),
            expiresAt: null,
            revokedAt,
        });
    }

    // Minimal PortalAccessResolver stub: resolveToken reads the seeded access
    // token rows directly from the test DB (mirrors PortalAccessService.resolveToken
    // shape — returns inspectionId/tenantId/role/recipientEmail/revokedAt/expiresAt).
    function makePortalAccessStub() {
        return {
            resolveToken: async (token: string) => {
                const rows = await testDb.select().from(schema.inspectionAccessTokens);
                const row = rows.find((r) => r.token === token);
                if (!row) return null;
                return {
                    inspectionId: row.inspectionId,
                    tenantId: row.tenantId,
                    role: row.role as 'client' | 'co_client' | 'agent',
                    recipientEmail: row.recipientEmail,
                    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
                    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
                };
            },
            // Idempotent get-or-create stub: returns the seeded row's plaintext
            // token for (inspection, recipient). The overview tests seed live rows
            // with a real `token` value, so this hands back that stable string.
            issueToken: async (input: { tenantId: string; inspectionId: string; recipientEmail: string }) => {
                const rows = await testDb.select().from(schema.inspectionAccessTokens);
                const row = rows.find(
                    (r) => r.inspectionId === input.inspectionId
                        && r.recipientEmail === input.recipientEmail
                        && r.revokedAt == null,
                );
                if (row) return row.token;
                const token = crypto.randomUUID();
                await testDb.insert(schema.inspectionAccessTokens).values({
                    id: crypto.randomUUID(),
                    tenantId: input.tenantId,
                    inspectionId: input.inspectionId,
                    recipientEmail: input.recipientEmail,
                    role: 'client',
                    token,
                    createdAt: new Date(),
                    expiresAt: null,
                    revokedAt: null,
                });
                return token;
            },
        };
    }

    function buildApp(tenantId: string | null = TENANT) {
        const portalSvc = new PortalService({} as D1Database, inspStub);
        sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (tenantId) {
                c.set('tenantId', tenantId);
                c.set('requestedTenantSlug', 'acme');
            }
            c.set('services', {
                portal: portalSvc,
                email: { sendEmail },
                portalAccess: makePortalAccessStub(),
                // Hub exchange (server/api/portal.ts) now resolves the
                // self-retrieve role-key set via PeopleService instead of a
                // hard-coded ['client', 'co_client'] literal check.
                people: new PeopleService({ DB: {} as D1Database }),
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/portal', portalRoutes);
        return app;
    }

    // Seed a token and return its raw token string (needed for the exchange tests,
    // which must present the token by value).
    async function seedTokenReturning(inspectionId: string, recipientEmail: string, role: 'client' | 'co_client' | 'agent' = 'client') {
        const token = crypto.randomUUID();
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(),
            tenantId: TENANT,
            inspectionId,
            recipientEmail,
            role,
            token,
            createdAt: new Date(),
            expiresAt: null,
            revokedAt: null,
        });
        return token;
    }

    // JWT_SECRET is injected via the env arg to app.request().
    function reqEnv() {
        return { JWT_SECRET: SECRET, APP_BASE_URL: 'https://example.test' } as unknown as HonoConfig['Bindings'];
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // Both listRecipientInspections and the /exchange capability gate now
        // derive their role filter from active role profiles' selfRetrieveReport
        // capability (client/co_client by default) instead of a hard-coded list.
        await seedRoleProfiles(testDb, TENANT, new Date(1));
    });

    it('POST /request-link returns 200 for a known recipient and sends an email', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request('/api/portal/acme/request-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@x.com' }),
        }, reqEnv());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.sent).toBe(true);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        const htmlArg = sendEmail.mock.calls[0][2] as string;
        expect(htmlArg).toContain('/portal/acme/auth?link=');
    });

    it('POST /request-link returns 200 for an UNKNOWN email and does NOT send (no enumeration)', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request('/api/portal/acme/request-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'nobody@x.com' }),
        }, reqEnv());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.sent).toBe(true);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('POST /request-link returns 404 when the tenant slug is unresolved', async () => {
        const app = buildApp(null);
        const res = await app.request('/api/portal/nope/request-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@x.com' }),
        }, reqEnv());
        expect(res.status).toBe(404);
    });

    it('GET /redeem validates the magic link → 200 with email; bad token → 401', async () => {
        const app = buildApp();
        const token = await signMagicLink(SECRET, 'a@x.com');
        const ok = await app.request(`/api/portal/acme/redeem?link=${encodeURIComponent(token)}`, {}, reqEnv());
        expect(ok.status).toBe(200);
        expect((await ok.json()).data.email).toBe('a@x.com');
        // Redeem now establishes the session: __Host-portal_session must be set.
        expect(ok.headers.get('set-cookie') ?? '').toContain('__Host-portal_session=');

        const bad = await app.request('/api/portal/acme/redeem?link=garbage', {}, reqEnv());
        expect(bad.status).toBe(401);
    });

    it('GET /exchange with a valid client token for the matching inspection → 200 + Set-Cookie', async () => {
        await seedInspection('insp1');
        const token = await seedTokenReturning('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request(
            `/api/portal/acme/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`,
            {}, reqEnv());
        expect(res.status).toBe(200);
        expect((await res.json()).data.email).toBe('a@x.com');
        expect(res.headers.get('set-cookie') ?? '').toContain('__Host-portal_session=');
    });

    it('GET /exchange with a bad token → 401', async () => {
        await seedInspection('insp1');
        const app = buildApp();
        const res = await app.request(
            '/api/portal/acme/exchange?token=garbage&inspectionId=insp1', {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('GET /exchange rejects a token whose inspection does not match → 401', async () => {
        await seedInspection('insp1');
        await seedInspection('insp2');
        const token = await seedTokenReturning('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request(
            `/api/portal/acme/exchange?token=${encodeURIComponent(token)}&inspectionId=insp2`,
            {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('GET /exchange rejects an agent-role token → 403', async () => {
        await seedInspection('insp1');
        const token = await seedTokenReturning('insp1', 'agent@x.com', 'agent');
        const app = buildApp();
        const res = await app.request(
            `/api/portal/acme/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`,
            {}, reqEnv());
        expect(res.status).toBe(403);
    });

    it('GET /exchange returns 404 when the tenant slug is unresolved', async () => {
        const app = buildApp(null);
        const res = await app.request(
            '/api/portal/nope/exchange?token=x&inspectionId=insp1', {}, reqEnv());
        expect(res.status).toBe(404);
    });

    it('GET /me without a session cookie → 401', async () => {
        const app = buildApp();
        const res = await app.request('/api/portal/acme/me', {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('GET /me with a valid session cookie → data.inspections populated', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/me', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.email).toBe('a@x.com');
        expect(json.data.inspections.length).toBeGreaterThan(0);
    });

    it('GET /inspections/:id/overview → 200 for an owned inspection', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/inspections/insp1/overview', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.address).toContain('insp1');
        // The Hub needs the recipient's persistent per-inspection token to build
        // section deep-links (works for magic-link sessions with no URL ?token).
        expect(typeof body.data.token).toBe('string');
        expect(body.data.token.length).toBeGreaterThan(0);
    });

    it('GET /inspections/:id/overview → 403 for an inspection the email does NOT own', async () => {
        await seedInspection('insp1');
        await seedInspection('insp2');
        await seedToken('insp1', 'a@x.com', 'client');
        await seedToken('insp2', 'other@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/inspections/insp2/overview', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(403);
    });

    it('GET /inspections/:id/observe → 401 without a session cookie', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request('/api/portal/acme/inspections/insp1/observe', {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('GET /inspections/:id/observe → 200 with named sections for an owned inspection', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/inspections/insp1/observe', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.data.sections)).toBe(true);
        expect(body.data.sections.length).toBeGreaterThan(0);
        expect(typeof body.data.sections[0].name).toBe('string');
        expect(typeof body.data.sections[0].totalItems).toBe('number');
        expect(typeof body.data.sections[0].completedItems).toBe('number');
    });

    it('GET /inspections/:id/observe → 403 for an inspection the email does NOT own', async () => {
        await seedInspection('insp1');
        await seedInspection('insp2');
        await seedToken('insp1', 'a@x.com', 'client');
        await seedToken('insp2', 'other@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/inspections/insp2/observe', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(403);
    });

    it('POST /logout → 200 {data:{ok:true}} and clears the session cookie (with a session present)', async () => {
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/logout', {
            method: 'POST',
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        expect((await res.json()).data.ok).toBe(true);
        // deleteCookie emits a clearing Set-Cookie (Max-Age=0 / past expiry).
        const setCookieHdr = res.headers.get('set-cookie') ?? '';
        expect(setCookieHdr).toContain('__Host-portal_session=');
        expect(setCookieHdr).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });

    it('POST /logout → 200 idempotent even with NO session cookie present', async () => {
        const app = buildApp();
        const res = await app.request('/api/portal/acme/logout', {
            method: 'POST',
        }, reqEnv());
        expect(res.status).toBe(200);
        expect((await res.json()).data.ok).toBe(true);
    });

    it('POST /logout → 200 even when the tenant slug is unresolved (clearing is tenant-agnostic)', async () => {
        const app = buildApp(null);
        const res = await app.request('/api/portal/nope/logout', {
            method: 'POST',
        }, reqEnv());
        expect(res.status).toBe(200);
        expect((await res.json()).data.ok).toBe(true);
    });
});
