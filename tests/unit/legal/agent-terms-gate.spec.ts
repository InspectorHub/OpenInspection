/**
 * The agent terms are a gate in front of every agent session, not a checkbox on
 * one form.
 *
 * There are three ways to hold an agent session and only one of them ever sees a
 * consent screen:
 *
 *   1. `POST /api/agent-signup`   — records the acceptance, already fail-closed
 *   2. `POST /api/agent/login`    — password, for an account that exists
 *   3. `GET  /agent/magic-login`  — emailed link, for an account that exists
 *
 * Two and three mint a 24-hour cookie and ask nothing. This file drives both of
 * them for real — sign in, take the cookie the route actually set, present it on
 * a protected agent route — because the only assertions that mean anything here
 * are about what a real request gets back. A harness that called the middleware
 * directly would pass whether or not it was ever mounted.
 *
 * ── The positive control is not decoration ──────────────────────────────────
 * Every refusal below is paired with a request that must SUCCEED: an agent who
 * accepted the version in force sails through the same gate on the same path
 * with the same cookie. A gate that blocks everything looks identical to a
 * working gate in a suite that only asserts blocking.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { hashPassword } from '../../../server/lib/password';
import { buildKeyring, type JwtKeyring } from '../../../server/lib/jwt-keyring';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { jwtAuthMiddleware } from '../../../server/lib/middleware/jwt-auth';
import { agentTermsGate } from '../../../server/lib/middleware/agent-terms-gate';
import { agentLoginRoutes } from '../../../server/api/agent/login';
import { agentTermsRoutes } from '../../../server/api/agent/terms';
import { agentMagicLoginRedeemRoutes } from '../../../server/api/agent/magic-login';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';
import { agentTermsStatus } from '../../../server/services/agent/terms-acceptance';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const AGENT_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_EMAIL = 'agent@example.com';
const PASSWORD = 'CorrectHorse123!Battery';
const PROTECTED = 'https://x.test/api/agent/referrals';

/** ES256 keypair helpers — the JWT middleware verifies for real here. */
function bufToPem(buf: ArrayBuffer, label: string): string {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END ${label}-----`;
}

async function genKeyring(): Promise<JwtKeyring> {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    return buildKeyring({
        JWT_PRIVATE_KEY_V1: bufToPem(await crypto.subtle.exportKey('pkcs8', privateKey), 'PRIVATE KEY'),
        JWT_PUBLIC_KEY_V1: bufToPem(await crypto.subtle.exportKey('spki', publicKey), 'PUBLIC KEY'),
        JWT_CURRENT_KID: 'v1',
    });
}

function makeKv(seed: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(seed));
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
        store,
    };
}

interface ErrorBody { success: boolean; error?: { code?: string; message?: string; details?: Record<string, unknown> } }

describe('the agent-terms gate', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let keyring: JwtKeyring;
    let kv: ReturnType<typeof makeKv>;

    beforeAll(async () => { keyring = await genKeyring(); });

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        kv = makeKv();
    });

    afterEach(() => sqlite.close());

    /**
     * The middleware chain in the order server/index.ts registers it: the JWT
     * middleware classifies the actor, the gate reads that classification.
     * `tests/unit/platform/middleware-order.spec.ts` is what pins that this
     * ordering is also the one the real app uses; this builds it so the routes
     * under test can be driven over real HTTP without the whole app graph.
     */
    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json(
                    { success: false, error: { code: err.code, message: err.message, details: err.details } },
                    err.status,
                );
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.env = { DB: {}, TENANT_CACHE: kv } as unknown as HonoConfig['Bindings'];
            c.set('profile', { mode: 'standalone' } as unknown as HonoConfig['Variables']['profile']);
            c.set('keyringPromise', Promise.resolve(keyring) as unknown as HonoConfig['Variables']['keyringPromise']);
            c.set('services', {
                email: { sendAgentLoginLink: vi.fn().mockResolvedValue(undefined) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.use('*', jwtAuthMiddleware);
        app.use('*', agentTermsGate);
        app.route('/api/agent', agentLoginRoutes);
        app.route('/api/agent', agentTermsRoutes);
        app.route('/', agentMagicLoginRedeemRoutes);
        // Stands in for any agent data route. The gate is keyed on the ACTOR and
        // mounted on `*`, so which path this is does not matter — which is the
        // property being relied on, and the reason a new agent route added later
        // is behind the gate without anyone remembering.
        app.get('/api/agent/referrals', (c) => c.json({ success: true, data: [] }));
        // A report-link path, for the exemption test below. Registered here
        // rather than inside that test because hono freezes its matcher on the
        // first request, and the test signs in before it asserts.
        app.get('/portal/acme/i/insp-1', (c) => c.json({ report: true }));
        // Account soft-delete, at its REAL mounted path. `server/index.ts` mounts
        // identityRoutes at `/api/identities` (plural) and the route declares
        // `/account/delete`. Two comments in the tree name it differently
        // (`identity.ts` says `/api/identity/…`, `user.ts` says `/api/account/…`)
        // and both are wrong — which matters here because EXEMPT_PATHS is an
        // exact-match Set, so a wrong string is an exemption that silently is not
        // one. Spelled out because that is the failure this test exists to stop.
        app.post('/api/identities/account/delete', (c) => c.json({ success: true }));
        // Account data export, at its REAL mounted path — same plural mount,
        // same exact-match hazard. `server/api/identity.ts` declares
        // `/account/export`, so the full path is
        // `/api/identities/account/export`; that file's own header said
        // `/api/identity/account/export` (singular) until this was added.
        app.post('/api/identities/account/export', (c) => c.json({ success: true, data: {} }));
        // The notification-preference surface, at its REAL mounted paths.
        // Stand-ins rather than the real routers, because what is under test is
        // the gate, which runs on `*` before anything is routed — but the PATHS
        // have to be the real ones or the assertions say nothing. `agent.ts`
        // mounts the preference router at `/`, itself mounted at `/api/agent`.
        app.get('/api/agent/notification-preferences', (c) => c.json({ success: true, data: {} }));
        app.put('/api/agent/notification-preferences', (c) => c.json({ success: true }));
        app.put('/api/agent/notification-preferences/bulk', (c) => c.json({ success: true }));
        app.put('/api/agent/notification-preferences/sms-consent', (c) => c.json({ success: true }));
        return app;
    }

    async function seedAgent(termsAccepted: unknown = null) {
        await db.insert(schema.users).values({
            id: AGENT_ID, tenantId: null, email: AGENT_EMAIL, name: 'Agent Smith',
            role: 'agent', createdAt: new Date(), passwordHash: await hashPassword(PASSWORD),
            termsAccepted,
        } as never);
    }

    /** Publish agent terms and return what an acceptance of them looks like. */
    async function publishTerms(version: string, body: string) {
        const svc = new DeploymentLegalService(db as never);
        const out = await svc.recordPublish({ doc: 'agent_terms', version, body });
        return {
            at: new Date().toISOString(),
            version: out.version,
            contentHash: out.contentHash,
        };
    }

    /** Sign in with a password and return the session cookie the route set. */
    async function passwordLoginCookie(app: OpenAPIHono<HonoConfig>): Promise<string> {
        const res = await app.request('https://x.test/api/agent/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: AGENT_EMAIL, password: PASSWORD }),
        });
        expect(res.status, 'password login itself must succeed — the gate comes after').toBe(200);
        const setCookie = res.headers.get('set-cookie') ?? '';
        const jwt = setCookie.match(/__Host-inspector_token=([^;]+)/)?.[1];
        expect(jwt, 'login must set the session cookie').toBeTruthy();
        return `__Host-inspector_token=${jwt}`;
    }

    /** Redeem an emailed magic-login code and return the cookie it set. */
    async function magicLinkCookie(app: OpenAPIHono<HonoConfig>): Promise<string> {
        const code = 'magic-code-1';
        await kv.put(`agent_ml:${code}`, JSON.stringify({ userId: AGENT_ID, issuedAt: Date.now() }));
        const res = await app.request(`https://x.test/agent/magic-login?code=${code}`);
        expect(res.status, 'the redeem itself must succeed — the gate comes after').toBe(302);
        expect(res.headers.get('location')).toBe('/agent-dashboard');
        const jwt = (res.headers.get('set-cookie') ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1];
        expect(jwt, 'redeem must set the session cookie').toBeTruthy();
        return `__Host-inspector_token=${jwt}`;
    }

    describe('an agent who has never accepted', () => {
        it('is gated after a PASSWORD login, not refused at the door', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();

            // Signing in works. That distinction is the whole point of 428: the
            // credentials are good, the account is fine, and one document is
            // outstanding. Answering 401 here would send them back to a login
            // page they had just used successfully.
            const cookie = await passwordLoginCookie(app);

            const res = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            expect(res.status).toBe(428);
            const body = (await res.json()) as ErrorBody;
            expect(body.error?.code).toBe('AGENT_TERMS_REQUIRED');
            expect(body.error?.details?.reason).toBe('never_accepted');
            // The way out travels in the refusal, so a client does not have to
            // hard-code this deployment's page.
            expect(body.error?.details?.acceptPath).toBe('/agent-accept-terms');
        });

        it('is gated after redeeming an emailed MAGIC LINK', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();

            const cookie = await magicLinkCookie(app);

            const res = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            expect(res.status).toBe(428);
            expect(((await res.json()) as ErrorBody).error?.code).toBe('AGENT_TERMS_REQUIRED');
        });
    });

    describe('an agent who accepted an OLDER version', () => {
        it('is gated, and the refusal says which version is wanted', async () => {
            const old = await publishTerms('2026-08-01', 'the first agent terms');
            await seedAgent(old);
            // A later publish supersedes it. Note this is a DIFFERENT body: the
            // service de-duplicates on content hash, so republishing the same
            // words returns the existing version and gates nobody.
            const current = await publishTerms('2026-09-01', 'the second agent terms');
            expect(current.contentHash).not.toBe(old.contentHash);

            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            const res = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            expect(res.status).toBe(428);
            const body = (await res.json()) as ErrorBody;
            expect(body.error?.details?.reason).toBe('superseded');
            expect(body.error?.details?.requiredVersion).toBe('2026-09-01');
        });

        it('is NOT gated when the republished text is byte-identical', async () => {
            const first = await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(first);
            // Same words, submitted again. The registry returns the existing
            // version rather than minting a second one, so nothing supersedes.
            const again = await publishTerms('2026-09-01', 'the agent terms');
            expect(again.version).toBe('2026-08-01');

            const app = buildApp();
            const cookie = await passwordLoginCookie(app);
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(200);
        });
    });

    describe('the positive control — the gate lets the right people through', () => {
        it('an agent holding the version in force passes on the SAME path and cookie', async () => {
            const current = await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(current);
            const app = buildApp();

            const cookie = await passwordLoginCookie(app);
            const res = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            expect(res.status).toBe(200);
            expect(((await res.json()) as { success: boolean }).success).toBe(true);
        });

        it('the same is true of a magic-link session', async () => {
            const current = await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(current);
            const app = buildApp();

            const cookie = await magicLinkCookie(app);
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(200);
        });

        it('a request with NO session is not gated — it is simply not an agent', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            // The gate is keyed on the actor. An anonymous caller has no
            // acceptance either, and answering 428 to them would tell an
            // unauthenticated stranger that this route belongs to agents.
            expect((await app.request(PROTECTED)).status).toBe(200);
        });
    });

    describe('the exits a gated agent must keep', () => {
        // The plan named four exemptions and gave one reason for all of them:
        // a gate whose only exits are "agree" and "lose the account" is the
        // dark pattern it set out to avoid. Three of the four hold structurally
        // (the accept page and its endpoint are listed; logout is cookie-only
        // and touches no API; the report-token track never sets `agentUserId`).
        // Account deletion is the one that needs an entry, and did not have one.
        it('a gated agent can still delete their account without accepting first', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Positive control on the fixture: this session really is gated, so
            // a pass below cannot be "the gate was off for everything".
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(428);

            const del = await app.request('https://x.test/api/identities/account/delete', {
                method: 'POST',
                headers: { Cookie: cookie, 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(del.status).not.toBe(428);
            expect(del.status).toBe(200);
        });

        /**
         * The privacy half of the gate's stated principle: the gate may restrict
         * functionality whose use requires the agent to be bound by the terms,
         * but it must not condition account exit OR applicable privacy-rights
         * mechanisms on acceptance. An export is the second one — not an exit,
         * the agent may well intend to stay, and it is their own data.
         *
         * Not covered by the deletion test above: EXEMPT_PATHS is an exact-match
         * Set, so "delete is exempt" says nothing whatever about export.
         */
        it('a gated agent can still EXPORT their account data without accepting first', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Positive control on the fixture: this session really is gated, so
            // a pass below cannot be "the gate was off for everything".
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(428);

            const exported = await app.request('https://x.test/api/identities/account/export', {
                method: 'POST',
                headers: { Cookie: cookie, 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(exported.status).not.toBe(428);
            expect(exported.status).toBe(200);
        });

        it('the export exemption does not leak to its neighbours under /api/identities', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // The control for the test above. Without it, "export is reachable"
            // is equally satisfied by an exemption that matched a prefix and
            // opened the whole identity surface.
            const sibling = await app.request('https://x.test/api/identities/account/export/extra', {
                method: 'POST',
                headers: { Cookie: cookie, 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(sibling.status).toBe(428);
        });

        /**
         * Reading the record of what you signed.
         *
         * `GET /api/agent/terms/history` returns the agent their own acceptance
         * ledger — every version they accepted, when, and the text that was
         * actually shown at the time. It takes no input at all: no query
         * parameter, no path parameter, no body, and therefore no account
         * identifier. The only account it can answer for is the one holding the
         * session.
         *
         * That places it beside the export entry above rather than beside the
         * product surface it used to be grouped with. It is not functionality
         * whose use requires the agent to be bound; it is a record ABOUT the
         * reader, and the specific record that says whether they are bound at
         * all. Answering "not until you accept these terms" to somebody asking
         * what they already accepted is the loop the exemption principle exists
         * to prevent — and it is worst for the agent who thinks they already
         * signed and wants to check.
         *
         * The exemption is from the GATE, not from authentication: the handler
         * checks `agentUserId` itself and 401s an anonymous caller, which is why
         * this can be exempt without opening anything.
         */
        it('a gated agent can still READ their own acceptance history', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Positive control on the fixture: this session really is gated, so
            // a pass below cannot be "the gate was off for everything".
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(428);

            const history = await app.request('https://x.test/api/agent/terms/history', {
                headers: { Cookie: cookie },
            });
            expect(history.status).not.toBe(428);
            expect(history.status).toBe(200);
        });

        it('the history exemption does not leak to its neighbours under /api/agent/terms', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // The control for the test above. Exact paths, never prefixes:
            // exempting the history read must not open everything beneath it.
            const sibling = await app.request('https://x.test/api/agent/terms/history/extra', {
                headers: { Cookie: cookie },
            });
            expect(sibling.status).toBe(428);
        });

        it('an ANONYMOUS history read is still refused — the exemption is from the gate, not from auth', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();

            // Exempting a path switches off the reason an unauthenticated caller
            // usually does not reach an agent route, because the JWT middleware
            // does not reject a token-less request — it simply sets nothing.
            const res = await app.request('https://x.test/api/agent/terms/history');
            expect(res.status).toBe(401);
        });

        it('the deletion exemption does not leak to its neighbours under /api/identities', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Exact paths, never prefixes: exempting the delete route must not
            // exempt everything mounted beside it.
            const sibling = await app.request('https://x.test/api/identities/account/delete/extra', {
                method: 'POST',
                headers: { Cookie: cookie, 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(sibling.status).toBe(428);
        });
    });

    /**
     * The notification-preference surface, and what a gated agent can and
     * cannot do about the email aimed at them.
     *
     * These four paths are GATED, and this block pins that rather than
     * describing it, because the reason they are gated turns on facts that can
     * change under them.
     *
     * The fact that matters: a blocked agent is not without a way out. Every
     * suppressible message sent to them carries its own unsubscribe link
     * (`server/lib/notifications/unsubscribe-footer.ts`), the page that link
     * lands on is mounted under `/api/public` and is structurally outside this
     * gate — the JWT middleware short-circuits before anybody is classified —
     * and the write it performs covers every subject the address stands for,
     * which is at least as much as the in-product switch writes. So a gated
     * agent can already stop the mail; what they cannot do is manage it from
     * inside the product.
     *
     * The three conditions that finding rests on are worth stating, because if
     * any of them stops holding, so does the reasoning: the link is minted only
     * where the send has a resolved tenant, a signing secret, and a configured
     * public base URL. A deployment with no base URL sends the message with no
     * footer at all.
     *
     * And these are not withdrawal endpoints. Both writes take a direction —
     * `enabled: boolean` on one, `enable | disable | reset` on the other — so
     * the same path that switches a message off switches it on. `sms-consent`
     * is further from the others still: it GRANTS consent to be texted, and an
     * exemption there would produce a consent record made by somebody who was
     * being told to sign something at the time. They share a URL prefix and not
     * an answer.
     */
    describe('notification preferences stay behind the gate', () => {
        const PREFERENCE_PATHS: Array<[string, string]> = [
            ['GET', 'https://x.test/api/agent/notification-preferences'],
            ['PUT', 'https://x.test/api/agent/notification-preferences'],
            ['PUT', 'https://x.test/api/agent/notification-preferences/bulk'],
            ['PUT', 'https://x.test/api/agent/notification-preferences/sms-consent'],
        ];

        it('refuses all four to an agent who has not accepted', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            const statuses = await Promise.all(PREFERENCE_PATHS.map(async ([method, url]) => {
                const res = await app.request(url, {
                    method,
                    headers: { Cookie: cookie, 'content-type': 'application/json' },
                    body: method === 'GET' ? undefined : JSON.stringify({}),
                });
                return `${method} ${new URL(url).pathname} ${res.status}`;
            }));

            expect(statuses).toEqual(PREFERENCE_PATHS.map(([method, url]) => `${method} ${new URL(url).pathname} 428`));
        });

        it('and lets the same four through once that agent accepts', async () => {
            // The positive control. Without it, "all four are refused" is
            // equally satisfied by four paths that do not exist, or by a gate
            // that refuses everybody — and the assertion above would still be
            // green in both of those worlds.
            const current = await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(current);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            const statuses = await Promise.all(PREFERENCE_PATHS.map(async ([method, url]) => {
                const res = await app.request(url, {
                    method,
                    headers: { Cookie: cookie, 'content-type': 'application/json' },
                    body: method === 'GET' ? undefined : JSON.stringify({}),
                });
                return `${method} ${new URL(url).pathname} ${res.status}`;
            }));

            expect(statuses).toEqual(PREFERENCE_PATHS.map(([method, url]) => `${method} ${new URL(url).pathname} 200`));
        });
    });

    describe('accepting, and the door that lets you', () => {
        it('POST /api/agent/accept-terms is exempt, and clears the gate for the same session', async () => {
            const current = await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(428);

            const accept = await app.request('https://x.test/api/agent/accept-terms', {
                method: 'POST',
                headers: { Cookie: cookie, 'content-type': 'application/json' },
                body: JSON.stringify({ accepted: true, shownContentHash: current.contentHash }),
            });
            expect(accept.status, 'the way out must not be behind the gate it opens').toBe(200);

            // Same cookie, same path, now through. No re-login, no new session.
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(200);

            const row = await db.select().from(schema.users).where(
                (await import('drizzle-orm')).eq(schema.users.id, AGENT_ID),
            ).get();
            const stored = row?.termsAccepted as { version?: string; contentHash?: string } | null;
            expect(stored?.version).toBe('2026-08-01');
            expect(stored?.contentHash).toBe(current.contentHash);
            // Evidence of what was SHOWN, never of where it lived.
            expect(JSON.stringify(stored)).not.toMatch(/https?:/);
        });

        it('refuses a page that rendered text no longer in force', async () => {
            const old = await publishTerms('2026-08-01', 'the first agent terms');
            await seedAgent(null);
            await publishTerms('2026-09-01', 'the second agent terms');
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            const res = await app.request('https://x.test/api/agent/accept-terms', {
                method: 'POST',
                headers: { Cookie: cookie, 'content-type': 'application/json' },
                body: JSON.stringify({ accepted: true, shownContentHash: old.contentHash }),
            });
            expect(res.status).toBe(400);
            // And nothing was written: an acceptance naming a version its signer
            // was never shown is worse than none.
            const row = await db.select().from(schema.users).where(
                (await import('drizzle-orm')).eq(schema.users.id, AGENT_ID),
            ).get();
            expect(row?.termsAccepted).toBeNull();
        });

        it('refuses an ANONYMOUS accept — the exemption is from the gate, not from auth', async () => {
            const current = await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();

            const res = await app.request('https://x.test/api/agent/accept-terms', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accepted: true, shownContentHash: current.contentHash }),
            });
            expect(res.status).toBe(401);
        });
    });

    describe('fail closed', () => {
        it('refuses when the version registry cannot be read', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Break the read AFTER the session exists, so the only thing that
            // changed is the registry's availability.
            const broken = {
                select: () => { throw new Error('D1_ERROR: no such table'); },
            };
            (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(broken);

            const res = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            // Deliberately unlike a fail-OPEN gate: an unreadable registry is an
            // outage, and passing on an outage means the gate is off exactly
            // when nobody is watching.
            expect(res.status).toBe(428);
            const details = ((await res.json()) as ErrorBody).error?.details;
            expect(details?.reason).toBe('unreadable');
            // An outage is its OWN state and must never arrive labelled as the
            // state in which the gate deliberately passes everybody. If those
            // two ever share a name, a deployment cannot tell "we published
            // nothing" from "the database is down" by reading the refusal.
            expect(details?.state).toBe('UNREADABLE');
            expect(details?.state).not.toBe('NOT_IN_FORCE');
        });

        /**
         * BOTH DIRECTIONS, one variable.
         *
         * The gate has a branch that answers "there is no document, therefore
         * everyone is compliant". That branch is the only shape a gate can take
         * that is indistinguishable from a gate which does not exist — and it is
         * the state EVERY deployment is in today, because the shipped
         * `app/content/legal/agent-terms.md` still carries placeholders and a
         * draft status line, so `agent-terms:publish` refuses it (pinned by the
         * tripwire at the bottom of this file).
         *
         * So the pass half on its own proves nothing: a suite that only ever
         * runs in the unpublished state would be green against a gate that was
         * never wired up. This asserts both halves for the SAME agent with the
         * SAME cookie on the SAME path, with the presence of a published
         * document as the only thing that differs between them.
         */
        it('passes when no document is in force, and blocks the same agent once one is', async () => {
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Nothing published — the gate is not enforcing, and says so.
            expect(
                (await app.request(PROTECTED, { headers: { Cookie: cookie } })).status,
                'with no document in force the gate must pass',
            ).toBe(200);

            // Publish. Nothing else about this agent or this request changes.
            await publishTerms('2026-08-01', 'the agent terms');

            const after = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            expect(
                after.status,
                'the SAME request must now be refused — otherwise the pass above was vacuous',
            ).toBe(428);
            expect(((await after.json()) as ErrorBody).error?.details?.reason).toBe('never_accepted');
        });

        it('does NOT refuse when the deployment has published no agent terms at all', async () => {
            // Nothing published. There is no text for anyone to accept, so a
            // refusal would be made on behalf of a document that does not exist
            // — and `POST /api/agent-signup` is already closed in this state, so
            // no NEW agent can appear here either. The population this spares is
            // agents who already exist on a deployment that has never had the
            // document, who would otherwise be locked out by an upgrade with no
            // action available to them.
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);
            expect((await app.request(PROTECTED, { headers: { Cookie: cookie } })).status).toBe(200);
        });
    });

    /**
     * The rename, asserted rather than described.
     *
     * `agentTermsStatus` used to answer `{ satisfied: boolean }`, and its own
     * comment called `no_document` "a SATISFIED reason". Two different facts —
     * "this deployment publishes no agent terms, so nobody is bound" and "this
     * agent accepted the version in force" — arrived as the same `true`, which
     * is precisely the shape in which an unconfigured control reads as a green
     * one. Both still PASS; the point of these assertions is that they are no
     * longer the same answer, and that the difference survives into the payload
     * a client sees.
     */
    describe('the two passing states are different facts', () => {
        it('separates "no contract in force" from "this agent accepted it"', async () => {
            const { eq } = await import('drizzle-orm');
            await seedAgent(null);

            // Nothing published. Passing, and named for the reason it passes.
            const none = await agentTermsStatus(db as never, AGENT_ID);
            expect(none.state).toBe('NOT_IN_FORCE');
            // The unpublished branch must not invent a requirement. `requirement`
            // exists only on REQUIRED, and the value has to agree with the type.
            expect('requirement' in none).toBe(false);
            expect(none.requiredVersion).toBeNull();

            // Publish, and bind this same agent to it. Nothing else changes.
            const current = await publishTerms('2026-08-01', 'the agent terms');
            await db.update(schema.users).set({ termsAccepted: current } as never)
                .where(eq(schema.users.id, AGENT_ID));

            const bound = await agentTermsStatus(db as never, AGENT_ID);
            expect(bound.state).toBe('ACCEPTED');
            expect(bound.requiredVersion).toBe('2026-08-01');

            // The assertion that could not be written before: under the old
            // boolean both of these were `satisfied: true` and nothing in the
            // returned value told them apart.
            expect(none.state).not.toBe(bound.state);
        });

        it('reports REQUIRED with the requirement that actually applies', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);

            const status = await agentTermsStatus(db as never, AGENT_ID);
            expect(status.state).toBe('REQUIRED');
            // Narrowed by the discriminant, which is the property the union
            // exists to provide: this read does not compile on any other state.
            expect(status.state === 'REQUIRED' && status.requirement).toBe('never_accepted');
        });

        it('carries the state into the refusal a client receives', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            const res = await app.request(PROTECTED, { headers: { Cookie: cookie } });
            expect(res.status).toBe(428);
            const details = ((await res.json()) as ErrorBody).error?.details;
            expect(details?.state).toBe('REQUIRED');
            expect(details?.reason).toBe('never_accepted');
        });
    });

    describe('the report-token track is never gated', () => {
        it('a public report path carrying an agent cookie passes untouched', async () => {
            await publishTerms('2026-08-01', 'the agent terms');
            await seedAgent(null);
            const app = buildApp();
            const cookie = await passwordLoginCookie(app);

            // Structural, not lucky: the JWT middleware short-circuits public
            // paths before classifying anyone, so `agentUserId` is never set and
            // the gate returns immediately. Gating a homebuyer's report link
            // would be a customer-facing outage caused by an agent-only rule.
            const res = await app.request('https://x.test/portal/acme/i/insp-1', {
                headers: { Cookie: cookie },
            });
            expect(res.status).toBe(200);
        });
    });
});

/**
 * Mounting. The tests above prove the gate WORKS; these prove it is somewhere an
 * agent request cannot go round — which is a different claim, and the one that
 * silently stops being true when someone reorders the chain.
 */
describe('the gate is mounted where it cannot be skipped', { timeout: 30_000 }, () => {
    it('runs on every path, after the JWT middleware and before the idempotency guard', async () => {
        const { app, idempotencyGuard } = await import('../../../server/index');
        const { jwtAuthMiddleware: realJwt } = await import('../../../server/lib/middleware/jwt-auth');
        const { agentTermsGate: realGate } = await import('../../../server/lib/middleware/agent-terms-gate');

        const indexOf = (handler: unknown, name: string): number => {
            const i = app.routes.findIndex((r) => r.handler === handler);
            expect(i, `${name} is not registered on the app`).toBeGreaterThanOrEqual(0);
            return i;
        };

        const jwt = indexOf(realJwt, 'jwtAuthMiddleware');
        const gate = indexOf(realGate, 'agentTermsGate');
        const idem = indexOf(idempotencyGuard, 'idempotencyGuard');

        // After the JWT middleware: the gate reads `agentUserId`, which only
        // that middleware sets. Anything earlier sees no actor and passes.
        expect(jwt).toBeLessThan(gate);
        // Before the idempotency guard: a 428 claimed and stored under an
        // idempotency key would be replayed to the agent after they accept.
        expect(gate).toBeLessThan(idem);

        // On `*`, not on a route group. There is no route list to forget to
        // update, which is what makes a future agent route gated by default.
        const entry = app.routes.find((r) => r.handler === realGate);
        // Hono normalises `app.use('*', …)` to a leading-slash path; what
        // matters is that it is the catch-all and not a prefix.
        expect(entry?.path).toBe('/*');
    });
});

/**
 * The tripwire.
 *
 * Everything above proves the gate WORKS. This records the fact that on every
 * deployment today it is not DOING anything, because the document it enforces
 * has never been publishable — and it makes that fact impossible to hold
 * quietly.
 *
 * `scripts/publish-agent-terms.mjs` refuses a body that still carries a
 * `{{PLACEHOLDER}}` or whose status line still says draft, and the shipped
 * `app/content/legal/agent-terms.md` carries both. So no version is ever in
 * force out of the box, `agentTermsStatus` takes its `no_document` branch, and
 * every signed-in agent passes. Whether the platform should ship a control that
 * is a no-op until an operator publishes is a product decision; this is what
 * stops it from being an accident.
 *
 * ⚠️ WHEN THIS GOES RED, DELETE IT — do not loosen it. Red here means the text
 * was approved and the gate started enforcing, which is the event this exists to
 * announce. Softening it back to green would restore exactly the silence it was
 * written to break.
 */
describe('the shipped agent-terms document, and what it means for the gate', () => {
    it('is still unpublishable, so a fresh deployment runs with the gate not enforcing', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        const raw = readFileSync(resolve(here, '../../../app/content/legal/agent-terms.md'), 'utf8');

        // Zero characters read is a failure, not a pass. A tripwire that quietly
        // measured an empty string would report "no placeholders" forever.
        expect(raw.length, 'could not read agent-terms.md — this check measured nothing').toBeGreaterThan(1000);

        // Both numbers, side by side, the same two predicates the publisher uses.
        const placeholders = [...new Set([...raw.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))];
        // Trimmed because the working tree may hold CRLF, and what either this
        // check or the publisher is judging is the line's CONTENT.
        const statusLine = raw.split('\n').map((l) => l.trim())
            .find((l) => /^\*\*Status:\*\*/.test(l)) ?? '(no status line)';
        const draftish = /draft|not published|unpublished|do not publish/i.test(statusLine);

        expect(
            { placeholders: placeholders.length, names: placeholders, statusLine, draftish },
        ).toEqual({
            placeholders: 3,
            names: ['OPERATOR_NAME', 'PRIVACY_URL', 'OPERATOR_CONTACT_EMAIL'],
            statusLine: '**Status:** draft (v5) — not published',
            draftish: true,
        });
    });
});
