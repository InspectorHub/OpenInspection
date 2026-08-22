/**
 * A support session stops being anonymous.
 *
 * The other half of the defect the actor column was added for, and the half that
 * reaches every support action rather than only the import seam. Somebody at the
 * deployment operator opens a customer's workspace by being signed in AS one of
 * that workspace's own administrators — a real account, a real session, and
 * until now an audit trail in which the two are the same row.
 *
 * The session token says which it is, because the token is the only thing that
 * travels with every request that session makes. Two flat claims and not a
 * boolean: `custom:isSupportSession: true` would say somebody, and "who at the
 * platform" is the entire question.
 *
 * ⚠️ The claim is trustworthy for the same reason `custom:tenantId` is — the
 * keyring signed it. It is set at one place only (the SSO consume handler, from
 * a value the M2M signature carried) and read at one place only (the JWT
 * middleware). Nothing may set it from a request header.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const { verifyJwtMock } = vi.hoisted(() => ({ verifyJwtMock: vi.fn() }));
vi.mock('../../../server/lib/jwt-keyring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/jwt-keyring')>();
    return { ...actual, verifyJwt: verifyJwtMock };
});

import { jwtAuthMiddleware } from '../../../server/lib/middleware/jwt-auth';
import { auditFromContext } from '../../../server/lib/audit';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const CUSTOMER_ADMIN = '00000000-0000-0000-0000-0000000000b1';
const PLATFORM_ADMIN_ID = 'pa-42';

/** The claims a session minted by password login carries. */
const CUSTOMER_CLAIMS = {
    sub: CUSTOMER_ADMIN,
    'custom:tenantId': TENANT,
    'custom:userRole': 'owner',
    role: 'owner',
    iat: Math.floor(Date.now() / 1000),
};

/** The same session, reached through a support handoff. Same `sub` — that is the point. */
const SUPPORT_CLAIMS = {
    ...CUSTOMER_CLAIMS,
    'custom:sso': true,
    'custom:platformActorId': PLATFORM_ADMIN_ID,
    'custom:platformActorEmail': 'ops@inspectorhub.io',
};

describe('a support session is distinguishable from the customer', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let env: Record<string, unknown>;

    /** One route that records one event, so the only variable is who signed in. */
    function app() {
        const a = new Hono<HonoConfig>();
        // 500, not a made-up 5xx: `ContentfulStatusCode` does not admit 599, and
        // nothing asserts on the number — the point is that a thrown error
        // surfaces as a body rather than as a silent pass.
        a.onError((err, c) => c.json({ e: String(err) }, 500));
        // `diMiddleware` normally supplies this; the spec supplies a resolved
        // stand-in because `verifyJwt` is mocked and never touches the keys.
        a.use('*', async (c, next) => {
            c.set('keyringPromise', Promise.resolve({} as never));
            c.set('profile', { mode: 'standalone' } as never);
            await next();
        });
        a.use('*', jwtAuthMiddleware);
        a.get('/act', (c) => {
            auditFromContext(c, 'template.update', 'template', { entityId: 't-1' });
            return c.json({ ok: true });
        });
        return a;
    }

    async function actAs(claims: Record<string, unknown>) {
        verifyJwtMock.mockResolvedValueOnce(claims);
        const res = await app().request('/act', { headers: { authorization: 'Bearer x.y.z' } }, env);
        expect(res.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const rows = await testDb.select().from(schema.auditLogs).all();
        return rows[rows.length - 1]!;
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        env = { DB: {}, JWT_CURRENT_KID: 'v1' };
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('a support session and the customer produce DIFFERENT audit rows', async () => {
        // The whole of the defect in one test. Today they are identical: the
        // support session is signed in as the customer's own administrator, so
        // `user_id` is that administrator on both rows and there is no other
        // column to ask.
        const byCustomer = await actAs(CUSTOMER_CLAIMS);
        const bySupport = await actAs(SUPPORT_CLAIMS);

        expect(byCustomer.actorKind).toBe('tenant_user');
        expect(bySupport.actorKind).toBe('platform_staff');
        expect(bySupport.platformActorId).toBe(PLATFORM_ADMIN_ID);

        // And the thing that made them indistinguishable is still true, which is
        // why a second column was needed rather than a different value in the
        // first: the account the action ran under really was the customer's.
        expect(bySupport.userId).toBe(byCustomer.userId);
    });

    it('an ordinary portal handoff is NOT a support session', async () => {
        // `custom:sso` marks every session minted through the portal — a normal
        // customer switching workspaces has it. Treating it as the marker would
        // stamp `platform_staff` on most SaaS traffic.
        const row = await actAs({ ...CUSTOMER_CLAIMS, 'custom:sso': true });
        expect(row.actorKind).toBe('tenant_user');
        expect(row.platformActorId).toBeNull();
    });

    it('a half-written claim is not a platform actor', async () => {
        // An id with no email, or an email with no id, is a token somebody built
        // wrong. Reading it as a support session would put a row in the log
        // naming a person the other half cannot identify.
        const noEmail = await actAs({ ...CUSTOMER_CLAIMS, 'custom:platformActorId': PLATFORM_ADMIN_ID });
        expect(noEmail.actorKind).toBe('tenant_user');

        const noId = await actAs({ ...CUSTOMER_CLAIMS, 'custom:platformActorEmail': 'ops@inspectorhub.io' });
        expect(noId.actorKind).toBe('tenant_user');
    });
});
