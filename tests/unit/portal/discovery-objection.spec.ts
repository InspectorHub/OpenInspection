import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { asD1Db } from '../helpers/test-db';

// GET /api/platform/tenants/by-email is a CROSS-TENANT existence oracle about
// one person: given an address it answers "which inspection companies hold a
// live report grant for you". It stays, because it is how a homebuyer who lost
// the email finds their own report — but a person must be able to object to it.
//
// The objection is the thing this suite pins, and the interesting property is
// not that suppression works. It is that the objection path cannot be turned
// into a denial-of-access tool aimed at somebody else: filing one requires
// proof of control of the address (an unrevoked grant token that was mailed to
// it), which is the SAME secret that already releases the report itself. Every
// negative assertion below is paired with a positive control, because a
// suppression bug and a broken discovery lookup both return `[]`.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';
import { PortalService } from '../../../server/services/portal.service';
import { hashToken } from '../../../server/lib/token-hash';

const TENANT = '00000000-0000-0000-0000-0000000000e1';
const SLUG = 'acme-obj';

// Addresses. MIXED is stored with capitals on purpose: the objection must not be
// bypassable by changing the case of the address in the query string.
const QUIET = 'quiet@example.com';
const GRANTED = 'jane@example.com';
const MIXED = 'Mixed@Example.com';

const TOKEN_QUIET = 'tok-quiet-0000000000000000000000';
const TOKEN_GRANTED = 'tok-granted-000000000000000000';
const TOKEN_GRANTED_REVOKED = 'tok-granted-revoked-0000000000';
const TOKEN_MIXED = 'tok-mixed-0000000000000000000';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

describe('find-my-report discovery — the objection path', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    function app() {
        const a = new OpenAPIHono<HonoConfig>();
        a.route('/api/platform', integrationRoutes);
        return a;
    }
    async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

    async function lookup(email: string) {
        const res = await app().request(
            `/api/platform/tenants/by-email?email=${encodeURIComponent(email)}`,
            { headers: { [M2M_HEADER]: await header() } },
            ENV,
        );
        const body = await res.json() as { data: { slugs: string[] } };
        return { status: res.status, slugs: body.data.slugs };
    }

    async function object(body: unknown, method: 'POST' | 'DELETE' = 'POST') {
        return app().request(
            '/api/platform/discovery-objections',
            {
                method,
                headers: { [M2M_HEADER]: await header(), 'content-type': 'application/json' },
                body: JSON.stringify(body),
            },
            ENV,
        );
    }

    async function seedGrant(opts: { id: string; inspectionId: string; email: string; token: string; revoked?: boolean }) {
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: opts.id, tenantId: TENANT, inspectionId: opts.inspectionId,
            recipientEmail: opts.email, role: 'client',
            tokenHash: await hashToken(opts.token),
            createdAt: new Date(1), expiresAt: null,
            revokedAt: opts.revoked ? new Date(2) : null,
        } as never);
    }

    beforeEach(async () => {
        const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(1),
        } as never);
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
        // One grant row per (inspection, recipient) — `inspection_access_tokens`
        // carries a unique index on that pair, so GRANTED's revoked grant needs
        // its own inspection rather than a second row on the same one.
        for (const id of ['i-quiet', 'i-granted', 'i-granted-2', 'i-mixed']) {
            await testDb.insert(schema.inspections).values({
                id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-06-01',
                status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', createdAt: new Date(1),
            } as never);
        }
        await seedGrant({ id: 'g-quiet', inspectionId: 'i-quiet', email: QUIET, token: TOKEN_QUIET });
        await seedGrant({ id: 'g-granted', inspectionId: 'i-granted', email: GRANTED, token: TOKEN_GRANTED });
        await seedGrant({ id: 'g-granted-rev', inspectionId: 'i-granted-2', email: GRANTED, token: TOKEN_GRANTED_REVOKED, revoked: true });
        await seedGrant({ id: 'g-mixed', inspectionId: 'i-mixed', email: MIXED, token: TOKEN_MIXED });
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('discovery finds both seeded addresses before anybody objects (positive control)', async () => {
        expect((await lookup(QUIET)).slugs).toEqual([SLUG]);
        expect((await lookup(GRANTED)).slugs).toEqual([SLUG]);
    });

    it('an objection filed with a live grant token stops the lookup for that address', async () => {
        const res = await object({ email: QUIET, grantToken: TOKEN_QUIET });
        expect(res.status).toBe(204);
        expect((await lookup(QUIET)).slugs).toEqual([]);
    });

    it('the objection is per person: everybody else stays discoverable', async () => {
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);
        expect((await lookup(GRANTED)).slugs).toEqual([SLUG]);
    });

    it('a suppressed lookup is INDISTINGUISHABLE from "no grants" — same status, same body', async () => {
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);
        const suppressed = await lookup(QUIET);
        const stranger = await lookup('nobody@example.com');
        expect(suppressed).toEqual(stranger);
    });

    it('an objection cannot be filed without proof of control — an unknown token is refused and the address stays discoverable', async () => {
        const res = await object({ email: GRANTED, grantToken: 'not-a-real-token-000000000000' });
        expect(res.status).toBe(403);
        expect((await lookup(GRANTED)).slugs).toEqual([SLUG]);
    });

    it('a valid token cannot silence a DIFFERENT address (this is the denial-of-access hole)', async () => {
        const res = await object({ email: GRANTED, grantToken: TOKEN_QUIET });
        expect(res.status).toBe(403);
        expect((await lookup(GRANTED)).slugs).toEqual([SLUG]);
    });

    it('a REVOKED grant token is not proof — same address, live token works and the revoked one does not', async () => {
        expect((await object({ email: GRANTED, grantToken: TOKEN_GRANTED_REVOKED })).status).toBe(403);
        expect((await lookup(GRANTED)).slugs).toEqual([SLUG]);
        expect((await object({ email: GRANTED, grantToken: TOKEN_GRANTED })).status).toBe(204);
        expect((await lookup(GRANTED)).slugs).toEqual([]);
    });

    // The first version of this test filed the objection as `Mixed@Example.com`
    // and asserted that lower- and upper-case lookups returned []. It passed
    // with the normalisation REMOVED, because the grant-matching SQL is
    // case-sensitive: any other-case query returns [] whether or not an
    // objection exists. The only query that discloses anything is the one
    // spelling the address exactly as the grant stores it, so that is the query
    // the objection has to cover — and the person filing it types their own
    // address, not the stored spelling.
    it('an objection filed in lower case covers the address as the GRANT stores it', async () => {
        expect((await lookup(MIXED)).slugs).toEqual([SLUG]);
        expect((await object({ email: MIXED.toLowerCase(), grantToken: TOKEN_MIXED })).status).toBe(204);
        expect((await lookup(MIXED)).slugs).toEqual([]);
    });

    it('the objection is withdrawable with the same proof, and discovery resumes', async () => {
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);
        expect((await lookup(QUIET)).slugs).toEqual([]);
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET }, 'DELETE')).status).toBe(204);
        expect((await lookup(QUIET)).slugs).toEqual([SLUG]);
    });

    // Exercises the upsert branch. One row per address is a UNIQUE index, so a
    // second filing either revives the existing row or raises a constraint
    // error — and changing one's mind twice is the ordinary case, not an edge.
    it('an objection can be filed again after being withdrawn', async () => {
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET }, 'DELETE')).status).toBe(204);
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);
        expect((await lookup(QUIET)).slugs).toEqual([]);
    });

    it('withdrawal also needs proof — an unknown token cannot un-silence somebody', async () => {
        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);
        expect((await object({ email: QUIET, grantToken: 'not-a-real-token-000000000000' }, 'DELETE')).status).toBe(403);
        expect((await lookup(QUIET)).slugs).toEqual([]);
    });

    it('a malformed body is a 400, not a silent no-op', async () => {
        expect((await object({ email: QUIET })).status).toBe(400);
        expect((await object({ grantToken: TOKEN_QUIET })).status).toBe(400);
    });

    it('objecting does NOT cost the person their own access — the per-tenant grant list is unchanged', async () => {
        const svc = new PortalService({} as D1Database, {
            getSectionProgress: async () => { throw new Error('unused in this suite'); },
        });
        const before = await svc.listRecipientInspections(TENANT, QUIET);
        expect(before.map((r) => r.inspectionId)).toEqual(['i-quiet']);

        expect((await object({ email: QUIET, grantToken: TOKEN_QUIET })).status).toBe(204);

        const after = await svc.listRecipientInspections(TENANT, QUIET);
        expect(after.map((r) => r.inspectionId)).toEqual(['i-quiet']);
    });
});
