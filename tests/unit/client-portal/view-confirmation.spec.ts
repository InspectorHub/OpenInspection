/**
 * OI #271 — report delivery confirmation, and the Art. 21 objection that must
 * ship with it.
 *
 * Two things these tests exist to pin down, in order of how easily they break:
 *
 *  1. **The counter must only count humans.** A corporate mail-security gateway
 *     opens every link in an inbound message; so do prefetchers, so does our own
 *     headless PDF pipeline, and so does the inspector previewing their own
 *     report. Counting any of them produces "your client opened the report" for
 *     a report no client has seen — a false statement to the inspector AND a
 *     phantom data point about the recipient.
 *
 *  2. **Objection is SUPPRESSION, not revocation.** Every objection test here
 *     asserts BOTH that the counter stopped AND that the report still loads.
 *     A test that only asserts "the count did not go up" passes just as happily
 *     against an implementation that revoked the token — which is the remedy
 *     `docs/compliance/report-view-lia.md` explicitly rejects, because it
 *     answers an objection about measurement by taking the document away.
 *
 * 🔓 **This suite used to run against a mocked kill switch.** Between the
 * counter landing and LIA conditions 4, 5 and 6 existing, `recordReportView`
 * sat behind `server/lib/report-views.gate.ts`, which defaulted to OFF — so
 * this suite had to `vi.mock` the gate ON to have a subject at all, and a
 * sibling file pinned the shut default. Conditions 4, 5 and 6 shipped, the gate
 * was deleted, and the mock went with it: the counter these tests describe is
 * now the counter the product runs. A mock left pointing at a deleted module is
 * worse than no mock — vitest resolves it lazily, so it can go quiet instead of
 * failing.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { signPortalSession } from '../../../server/lib/portal-session';
import { signRenderToken } from '../../../server/lib/render-token';
import { buildKeyring, signJwt, type JwtKeyring } from '../../../server/lib/jwt-keyring';
import { shouldCountReportView, getReportView } from '../../../server/lib/report-views';
import publicReportRoutes from '../../../server/api/public-report';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const SECRET = 'test-jwt-secret';
const INSP = 'insp-271-1';

/**
 * The `report_views` table and `inspection_access_tokens.view_tracking_objected_at`
 * are declared in `server/lib/db/schema/portal-access.ts`, but `setupSchema()`
 * replays `migrations/*.sql` and the forward migration for them is generated
 * separately (migration numbering is serialised across the branch).
 *
 * Idempotent on purpose — every statement is a no-op once that migration lands,
 * at which point this helper can be deleted outright.
 */
function ensureViewSchema(sqlite: { exec: (s: string) => void }) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS report_views (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        inspection_id text NOT NULL,
        access_token_id text NOT NULL,
        first_viewed_at integer,
        last_viewed_at integer,
        view_count integer DEFAULT 0 NOT NULL
    );`);
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_report_views_scope
        ON report_views (tenant_id, inspection_id, access_token_id);`);
    try {
        sqlite.exec('ALTER TABLE inspection_access_tokens ADD COLUMN view_tracking_objected_at integer;');
    } catch {
        /* already present — the real migration landed */
    }
}

async function genKeypairPem() {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    const pem = (buf: ArrayBuffer, label: string) => {
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END ${label}-----`;
    };
    return {
        privatePem: pem(await crypto.subtle.exportKey('pkcs8', privateKey), 'PRIVATE KEY'),
        publicPem: pem(await crypto.subtle.exportKey('spki', publicKey), 'PUBLIC KEY'),
    };
}

describe('OI #271 — report view confirmation', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let portalAccess: PortalAccessService;
    let keyring: JwtKeyring;

    beforeAll(async () => {
        const v1 = await genKeypairPem();
        keyring = await buildKeyring({
            JWT_PRIVATE_KEY_V1: v1.privatePem,
            JWT_PUBLIC_KEY_V1: v1.publicPem,
            JWT_CURRENT_KID: 'v1',
        });
    });

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {}, JWT_SECRET: SECRET };
            c.set('keyringPromise', Promise.resolve(keyring) as never);
            c.set('services', {
                portalAccess,
                inspection: {
                    getReportData: vi.fn().mockResolvedValue({ inspectionId: INSP, sections: [] }),
                    resolveAgentViewToken: vi.fn().mockResolvedValue(null),
                },
                reportVersion: { getLatestPublished: vi.fn().mockResolvedValue(null) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        ensureViewSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // Counting is OFF by default now (a legitimate interest may not be a
        // mask for processing its supposed beneficiary cannot decline),
        // so every case below has to enable it or it would be asserting that the
        // counter works while the switch was refusing every request. That is not
        // fixture noise: it is the tenant decision the whole feature now rests on,
        // and a suite that omitted it would be green about a counter it never ran.
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT, reportViewCountingEnabled: true, updatedAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), TENANT);
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
            price: 0, createdAt: new Date(),
        });
        portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
    });

    const issue = (email = 'client@x.com', role = 'client') =>
        portalAccess.issueToken({ tenantId: TENANT, inspectionId: INSP, recipientEmail: email, role });

    const reportUrl = (token?: string, extra = '') =>
        `/api/public/report/acme/${INSP}${token ? `?token=${token}` : '?'}${extra}`;

    /** The one seeded recipient's token row id. */
    async function tokenId() {
        return (await testDb.select().from(schema.inspectionAccessTokens))[0].id;
    }

    /**
     * The counter row, read through the module's own accessor, or a zeroed
     * stand-in. Reading it via `getReportView` rather than a raw select is
     * deliberate: the scope it is keyed on — (tenant, inspection, token) and
     * NOT a report id — is part of what these tests pin down.
     */
    async function counters() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = await getReportView(testDb as any, {
            tenantId: TENANT, inspectionId: INSP, accessTokenId: await tokenId(),
        });
        return row ?? { viewCount: 0, firstViewedAt: null, lastViewedAt: null };
    }

    /* ---------------- the counter counts a human ---------------- */

    it('records a view when a human renders the report page', async () => {
        const token = await issue();
        const res = await buildApp().request(reportUrl(token));
        expect(res.status).toBe(200);
        const row = await counters();
        expect(row.viewCount).toBe(1);
        expect(row.firstViewedAt).not.toBeNull();
    });

    it('records NOTHING for a tenant that has not enabled counting, through the real route', async () => {
        // The pure-function test covers the predicate. This one covers the WIRE:
        // that the route actually reads the tenant's decision and hands it to
        // `shouldCountReportView`. A switch nothing passes to the check is a
        // switch that does not exist, and this repository has six recorded cases
        // of exactly that.
        await testDb.update(schema.tenantConfigs)
            .set({ reportViewCountingEnabled: false })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));

        const token = await issue();
        const res = await buildApp().request(reportUrl(token));

        // The report is still READABLE. Not counting is not gating.
        expect(res.status).toBe(200);
        expect((await counters()).viewCount).toBe(0);
    });

    it('records nothing when the tenant has no config row at all', async () => {
        // Absence must read as OFF, matching the column default. A workspace that
        // has never opened the settings page has not opted in — and reading a
        // missing row as enabled would make the default the opposite of the one
        // the assessment is written around.
        await testDb.delete(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));

        const token = await issue();
        expect((await buildApp().request(reportUrl(token))).status).toBe(200);
        expect((await counters()).viewCount).toBe(0);
    });

    it('keeps first_viewed_at at the FIRST view and increments the count', async () => {
        const token = await issue();
        vi.setSystemTime(new Date('2026-08-07T10:00:00Z'));
        await buildApp().request(reportUrl(token));
        const first = (await counters()).firstViewedAt;
        vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
        await buildApp().request(reportUrl(token));
        const row = await counters();
        expect(row.firstViewedAt?.getTime()).toBe(first?.getTime());
        expect(row.lastViewedAt?.getTime()).not.toBe(first?.getTime());
        expect(row.viewCount).toBe(2);
        vi.useRealTimers();
    });

    it('counts per recipient, not per order', async () => {
        const a = await issue('client@x.com', 'client');
        const b = await issue('agent@x.com', 'buyer_agent');
        await buildApp().request(reportUrl(a));
        await buildApp().request(reportUrl(a));
        await buildApp().request(reportUrl(b));
        const rows = await testDb.select().from(schema.reportViews);
        expect(rows.map((r) => r.viewCount).sort()).toEqual([1, 2]);
    });

    /* ---------------- and only a human ---------------- */

    it('does NOT record a view for a link-scanner HEAD request', async () => {
        // Corporate mail security opens every link in an inbound email.
        const token = await issue();
        await buildApp().request(reportUrl(token), { method: 'HEAD' });
        expect((await counters()).viewCount).toBe(0);
    });

    it('does NOT record a view when the page loader relays a HEAD outer request', async () => {
        // The report page is served by the RR loader, which calls this route
        // with a fresh in-process GET. Without the relayed method the HEAD
        // filter above would be green in tests and blind in production, because
        // no scanner talks to /api/public/report directly.
        const token = await issue();
        await buildApp().request(reportUrl(token), { headers: { 'x-oi-client-method': 'HEAD' } });
        expect((await counters()).viewCount).toBe(0);
    });

    it('does NOT record a view for a declared prefetch / prerender', async () => {
        const token = await issue();
        const app = buildApp();
        await app.request(reportUrl(token), { headers: { purpose: 'prefetch' } });
        await app.request(reportUrl(token), { headers: { 'sec-purpose': 'prefetch;prerender' } });
        expect((await counters()).viewCount).toBe(0);
    });

    it('does NOT record a view for the headless PDF pipeline (?render=)', async () => {
        // publish.ts / report-delivery.ts / the PDF download route all drive the
        // report page through Browser Rendering. That is the product opening its
        // own document, several times per order.
        await issue();
        const render = await signRenderToken(INSP, SECRET);
        const res = await buildApp().request(`/api/public/report/acme/${INSP}?render=${render}`);
        expect(res.status).toBe(200);
        expect((await counters()).viewCount).toBe(0);
    });

    it('does NOT record a view for the inspector previewing their own report', async () => {
        await issue();
        const session = await signJwt(
            { sub: 'user-1', 'custom:userRole': 'admin', 'custom:tenantId': TENANT }, keyring,
        );
        const res = await buildApp().request(`/api/public/report/acme/${INSP}`, {
            headers: { authorization: `Bearer ${session}` },
        });
        expect(res.status).toBe(200);
        expect((await counters()).viewCount).toBe(0);
    });

    it('does NOT record a view when the token is spent on a non-render endpoint', async () => {
        // resolveToken() fires for every consumption path; only a rendered
        // report page counts. The photo route resolves the same token.
        const token = await issue();
        await buildApp().request(
            `/api/public/report/acme/${INSP}/photo?key=${encodeURIComponent(`${TENANT}/inspections/${INSP}/a.jpg`)}&token=${token}`,
        );
        expect((await counters()).viewCount).toBe(0);
    });

    it('shouldCountReportView refuses every non-human shape', () => {
        // `countingEnabled: true` is required for these cases to mean anything.
        // The tenant switch is checked FIRST, so with it false every assertion
        // below would pass for the wrong reason — the suite would be green about
        // prefetch and render-mode suppression it never actually exercised.
        const human = {
            countingEnabled: true,
            accessTokenId: 'tok-1', renderMode: false, ownerPreview: false, method: 'GET',
        };
        expect(shouldCountReportView(human)).toBe(true);
        expect(shouldCountReportView({ ...human, accessTokenId: null })).toBe(false);
        expect(shouldCountReportView({ ...human, method: 'HEAD' })).toBe(false);
        expect(shouldCountReportView({ ...human, renderMode: true })).toBe(false);
        expect(shouldCountReportView({ ...human, ownerPreview: true })).toBe(false);
        expect(shouldCountReportView({ ...human, purpose: 'Prefetch' })).toBe(false);
        expect(shouldCountReportView({ ...human, secPurpose: 'prefetch;prerender' })).toBe(false);
        // The tenant's own decision, in front of all of them.
        expect(shouldCountReportView({ ...human, countingEnabled: false })).toBe(false);
    });

    /* ---------------- Art. 21 — suppression, not revocation ---------------- */

    it('an objection stops the counter AND leaves the report readable', async () => {
        const token = await issue();
        const app = buildApp();
        await app.request(reportUrl(token));
        expect((await counters()).viewCount).toBe(1);

        const obj = await app.request(
            `/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ objected: true }),
            },
        );
        expect(obj.status).toBe(200);

        const after = await app.request(reportUrl(token));
        // BOTH halves, always. "The count did not go up" is equally true of an
        // implementation that revoked the link, and that is the rejected remedy.
        expect(after.status).toBe(200);
        expect((await counters()).viewCount).toBe(1);
    });

    it('an objection does NOT clear counters already recorded (Art. 21 is not Art. 17)', async () => {
        const token = await issue();
        const app = buildApp();
        await app.request(reportUrl(token));
        await app.request(reportUrl(token));
        await app.request(`/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ objected: true }),
        });
        const row = await counters();
        expect(row.viewCount).toBe(2);
        expect(row.firstViewedAt).not.toBeNull();
    });

    it('an objection never writes revokedAt or expiresAt', async () => {
        const token = await issue();
        // Captured BEFORE, not asserted null: a freshly issued link now carries
        // the default report-link TTL, so the claim under test is that the
        // objection LEAVES BOTH ALONE — suppression, not revocation.
        const before = (await testDb.select().from(schema.inspectionAccessTokens))[0];
        await buildApp().request(`/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ objected: true }),
        });
        const row = (await testDb.select().from(schema.inspectionAccessTokens))[0];
        expect(row.revokedAt).toEqual(before.revokedAt);
        expect(row.revokedAt).toBeNull();
        expect(row.expiresAt).toEqual(before.expiresAt);
        expect(row.viewTrackingObjectedAt).not.toBeNull();
    });

    it('objecting twice keeps the FIRST date (the retry must not move it)', async () => {
        const token = await issue();
        const app = buildApp();
        const post = () => app.request(
            `/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected: true }) },
        );
        vi.setSystemTime(new Date('2026-08-07T10:00:00Z'));
        const first = await (await post()).json() as { data: { objectedAt: string } };
        vi.setSystemTime(new Date('2026-08-09T10:00:00Z'));
        const second = await (await post()).json() as { data: { objectedAt: string } };
        // The date on record is when the person asked, not when their browser
        // last retried.
        expect(second.data.objectedAt).toBe(first.data.objectedAt);
        vi.useRealTimers();
    });

    it('the objection can be withdrawn and counting resumes', async () => {
        const token = await issue();
        const app = buildApp();
        const set = (objected: boolean) => app.request(
            `/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected }) },
        );
        await set(true);
        await app.request(reportUrl(token));
        expect((await counters()).viewCount).toBe(0);
        await set(false);
        await app.request(reportUrl(token));
        expect((await counters()).viewCount).toBe(1);
    });

    it('GET reports the objection state, with its date', async () => {
        const token = await issue();
        const app = buildApp();
        const before = await app.request(`/api/public/inspections/${INSP}/view-tracking?token=${token}`);
        expect(await before.json()).toMatchObject({ data: { objected: false, objectedAt: null } });
        await app.request(`/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected: true }),
        });
        const after = await app.request(`/api/public/inspections/${INSP}/view-tracking?token=${token}`);
        const body = await after.json() as { data: { objected: boolean; objectedAt: string | null } };
        expect(body.data.objected).toBe(true);
        expect(typeof body.data.objectedAt).toBe('string');
    });

    /* ---------------- both entry paths reach the right ---------------- */

    it('the objection is reachable over the emailed ?token= link (no session)', async () => {
        const token = await issue();
        const res = await buildApp().request(
            `/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected: true }) },
        );
        expect(res.status).toBe(200);
        expect((await testDb.select().from(schema.inspectionAccessTokens))[0].viewTrackingObjectedAt).not.toBeNull();
    });

    it('the objection is reachable over the __Host-portal_session cookie (no ?token)', async () => {
        // Both paths or neither: a right that works on one of the two portal
        // entry points is a right most recipients cannot reach.
        await issue();
        const cookie = await signPortalSession(SECRET, 'client@x.com');
        const res = await buildApp().request(`/api/public/inspections/${INSP}/view-tracking-objection`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: `__Host-portal_session=${cookie}` },
            body: JSON.stringify({ objected: true }),
        });
        expect(res.status).toBe(200);
        expect((await testDb.select().from(schema.inspectionAccessTokens))[0].viewTrackingObjectedAt).not.toBeNull();
    });

    it('an AGENT recipient can object too (the weakest-expectation population)', async () => {
        const token = await issue('agent@x.com', 'buyer_agent');
        const res = await buildApp().request(
            `/api/public/inspections/${INSP}/view-tracking-objection?token=${token}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected: true }) },
        );
        expect(res.status).toBe(200);
    });

    it('401 without any grant', async () => {
        await issue();
        const res = await buildApp().request(`/api/public/inspections/${INSP}/view-tracking-objection`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objected: true }),
        });
        expect(res.status).toBe(401);
    });
});
