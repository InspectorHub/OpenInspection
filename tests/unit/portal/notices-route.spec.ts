/**
 * Track C3 — GET/POST/DELETE /api/portal/:tenant/notices, at the HTTP layer.
 *
 * The service-level rules live in tests/unit/notifications/notice-inbox.spec.ts.
 * What only a route test can prove:
 *
 *  - the session gate actually runs (no cookie -> 401, not an empty list, which
 *    is what an unguarded route returns and looks identical to a clean inbox);
 *  - the tenant in the PATH scopes the lookup, so a session email that is also
 *    a contact in another company reads nothing of theirs here;
 *  - a dismissal reaches `notifications` and stops there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { signPortalSession } from '../../../server/lib/portal-session';
import portalNoticeRoutes from '../../../server/api/portal/notices';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000c3';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000c4';
const SLUG = 'acme-notices';
const SECRET = 'test-jwt-secret-notices';

describe('client portal Notices routes', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('requestedTenantSlug', SLUG);
            await next();
        });
        app.route('/api/portal', portalNoticeRoutes);
        return app;
    }

    const reqEnv = () => ({ JWT_SECRET: SECRET, DB: {} as D1Database } as unknown as HonoConfig['Bindings']);

    async function sessionCookie(email: string) {
        const sess = await signPortalSession(SECRET, email);
        return `__Host-portal_session=${sess}`;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const now = new Date();
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: SLUG, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
            { id: OTHER_TENANT, slug: 'other-notices', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
        ] as never);
        await testDb.insert(schema.contacts).values([
            { id: 'c-jane', tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: now },
            { id: 'c-ray', tenantId: TENANT, type: 'client', name: 'Ray', email: 'ray@x.com', createdAt: now },
            { id: 'c-jane-other', tenantId: OTHER_TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', createdAt: now },
        ] as never);
        await testDb.insert(schema.notifications).values([
            { id: 'n-jane', tenantId: TENANT, userId: null, contactId: 'c-jane', type: 'report.published', title: 'Your report is ready', inspectionId: 'insp-1', createdAt: now },
            { id: 'n-ray', tenantId: TENANT, userId: null, contactId: 'c-ray', type: 'report.published', title: 'Your report is ready', inspectionId: 'insp-1', createdAt: now },
            { id: 'n-jane-other', tenantId: OTHER_TENANT, userId: null, contactId: 'c-jane-other', type: 'report.published', title: 'Other company notice', inspectionId: 'insp-9', createdAt: now },
        ] as never);
        await testDb.insert(schema.automationLogs).values([
            { id: 'l-jane', tenantId: TENANT, automationId: 'a1', inspectionId: 'insp-1', recipient: 'jane@x.com', channel: 'email', sendAt: now, status: 'sent', noticeId: 'n-jane' },
            { id: 'l-ray', tenantId: TENANT, automationId: 'a1', inspectionId: 'insp-1', recipient: 'ray@x.com', channel: 'email', sendAt: now, status: 'failed', error: 'mailbox unavailable', noticeId: 'n-ray' },
        ] as never);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('without a session cookie the inbox is 401, not an empty list', async () => {
        const res = await buildApp().request(`/api/portal/${SLUG}/notices`, {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it("returns only the caller's notices — no other recipient's address is in the payload", async () => {
        const res = await buildApp().request(
            `/api/portal/${SLUG}/notices`,
            { headers: { cookie: await sessionCookie('jane@x.com') } },
            reqEnv(),
        );
        expect(res.status).toBe(200);
        const text = await res.text();
        const body = JSON.parse(text) as { data: { notices: Array<{ id: string }>; unread: number } };
        expect(body.data.notices.map((n) => n.id)).toEqual(['n-jane']);
        expect(body.data.unread).toBe(1);
        expect(text).not.toContain('ray@x.com');
    });

    it("the path tenant scopes the lookup — the same email's notices in another company stay there", async () => {
        const res = await buildApp().request(
            `/api/portal/${SLUG}/notices`,
            { headers: { cookie: await sessionCookie('jane@x.com') } },
            reqEnv(),
        );
        const body = (await res.json()) as { data: { notices: Array<{ id: string }> } };
        expect(body.data.notices.map((n) => n.id)).not.toContain('n-jane-other');
    });

    it('mark-read with no ids clears every unread notice the caller owns, and no one else\'s', async () => {
        const app = buildApp();
        const cookie = await sessionCookie('jane@x.com');
        const res = await app.request(
            `/api/portal/${SLUG}/notices/mark-read`,
            { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' },
            reqEnv(),
        );
        expect(res.status).toBe(200);
        const rows = await testDb.select().from(schema.notifications).all();
        expect(rows.find((r) => r.id === 'n-jane')!.readAt).not.toBeNull();
        expect(rows.find((r) => r.id === 'n-ray')!.readAt).toBeNull();
    });

    it('dismissing archives the header and leaves the delivery ledger alone', async () => {
        const res = await buildApp().request(
            `/api/portal/${SLUG}/notices/n-jane`,
            { method: 'DELETE', headers: { cookie: await sessionCookie('jane@x.com') } },
            reqEnv(),
        );
        expect(res.status).toBe(200);
        const header = (await testDb.select().from(schema.notifications).all()).find((r) => r.id === 'n-jane')!;
        expect(header.archivedAt).not.toBeNull();
        const logs = await testDb.select().from(schema.automationLogs).all();
        expect(logs).toHaveLength(2);
        expect(logs.find((l) => l.id === 'l-jane')!.status).toBe('sent');
    });

    it('the opt-in link is minted for the notice\'s own contact, and 404s on anyone else\'s notice', async () => {
        const app = buildApp();
        const cookie = await sessionCookie('jane@x.com');
        const mine = await app.request(`/api/portal/${SLUG}/notices/n-jane/optin-link`, { headers: { cookie } }, reqEnv());
        expect(mine.status).toBe(200);
        const body = (await mine.json()) as { data: { url: string } };
        // `<tenantId>~<sealed contactId>` — the tenant travels in clear so the
        // server can pick the key; the contact is sealed under it.
        expect(body.data.url).toMatch(/^\/sms-optin\/.+/);
        expect(decodeURIComponent(body.data.url)).toContain(TENANT);

        const theirs = await app.request(`/api/portal/${SLUG}/notices/n-ray/optin-link`, { headers: { cookie } }, reqEnv());
        expect(theirs.status).toBe(404);
    });

    it("a dismissal aimed at someone else's notice changes nothing", async () => {
        const res = await buildApp().request(
            `/api/portal/${SLUG}/notices/n-ray`,
            { method: 'DELETE', headers: { cookie: await sessionCookie('jane@x.com') } },
            reqEnv(),
        );
        expect(res.status).toBe(200);
        const ray = (await testDb.select().from(schema.notifications).all()).find((r) => r.id === 'n-ray')!;
        expect(ray.archivedAt).toBeNull();
    });
});
