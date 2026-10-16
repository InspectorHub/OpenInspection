/**
 * Native client OAuth lifecycle against the REAL OAuth provider library, in
 * workerd: dynamic registration, authorization with PKCE, code exchange,
 * refresh, the 90-day idle limit, and mass revocation.
 *
 * What is real: the provider (token endpoint, grant storage in a real KV, the
 * tokenExchangeCallback in server/lib/mcp/oauth-provider.ts), the Hono app with
 * its auth middleware, D1 with the real migrations, and
 * completeNativeAuthorization (the code the consent action runs).
 *
 * What is stood in: the consent PAGE. `/oauth/authorize` is a React Router
 * route that needs a browser session and SSR; here a small handler plays the
 * part of its action by calling the same completeNativeAuthorization (or, for
 * the MCP control, the same completeAuthorization call the MCP branch makes).
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import app from '../../../server/index';
import { buildOAuthHandler } from '../../../server/lib/mcp/oauth-provider';
import { completeNativeAuthorization, NATIVE_GRANTS_PER_USER_MAX } from '../../../server/lib/auth/native-consent';
import { revokeAllUserGrants } from '../../../server/lib/mcp/grants';
import { NATIVE_IDLE_LIMIT_S, NATIVE_REFRESH_MAX_TTL_S } from '../../../server/lib/auth/native-token';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { applyMigrations as replayMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const TENANT = 'native-tenant';
const USER = 'native-user';
const OTHER_USER = 'native-other-user';
const GONE_USER = 'native-gone-user';
const MULTI_USER = 'native-multi-user';
const PW_USER = 'native-pw-user';
const LEGACY_USER = 'native-legacy-user';
const REDIRECT = 'io.example.fieldapp:/oauth/callback';
const ORIGIN = 'https://x.test';

const b = testEnv as unknown as { DB: D1Database };
const env = {
    ...testEnv,
    APP_MODE: 'standalone',
    MCP_ENABLED: 'true',
    NATIVE_CLIENT_ENABLED: 'true',
} as unknown as Record<string, unknown>;
/** Same deployment with only MCP opted in: the OAuth provider is mounted, native clients are not. */
const mcpOnlyEnv = { ...env, NATIVE_CLIENT_ENABLED: undefined } as Record<string, unknown>;
/** Same deployment with only native clients opted in: the provider is mounted, MCP itself is off. */
const nativeOnlyEnv = { ...env, MCP_ENABLED: undefined } as Record<string, unknown>;
/** Neither consumer opted in: no provider at all. */
const neitherEnv = { ...env, MCP_ENABLED: undefined, NATIVE_CLIENT_ENABLED: undefined } as Record<string, unknown>;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/**
 * Stands in for the consent page's action, plus two test-only probes that need
 * the provider helpers the library injects into the request env.
 *
 * Correspondence with the real route (app/routes/oauth/authorize.tsx): the
 * `includes('native')` test below is the action's `isNativeAuthRequest` branch,
 * and the 404/400/403 refusals come from the same completeNativeAuthorization it
 * calls. This copy does NOT guard the real branch: the loader and action
 * themselves are exercised in app/routes/oauth/oauth-authorize.test.ts, where
 * removing the branch turns a test red. Here the point is the provider-side
 * lifecycle.
 */
async function appOrConsent(req: Request, e: Record<string, unknown>, c: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const oauth = e.OAUTH_PROVIDER as OAuthHelpers;
    if (url.pathname === '/oauth/authorize') {
        const authReq: AuthRequest = await oauth.parseAuthRequest(req);
        const who = url.searchParams.get('as') ?? USER;
        let redirectTo: string;
        if (url.searchParams.get('legacy') === '1') {
            // A grant that says it is native but lacks a field a valid one carries (written before `grantedAt` existed).
            ({ redirectTo } = await oauth.completeAuthorization({
                request: authReq, userId: who, scope: authReq.scope ?? [], metadata: { clientName: 'Field App', kind: 'native' },
                props: { kind: 'native', userId: who, tenantId: TENANT, role: 'inspector', lastUsedAt: Math.floor(Date.now() / 1000) }, // seed-lint-ok: grant props carry epoch seconds, not a timestamp_ms column
            }));
        } else if ((authReq.scope ?? []).includes('native')) {
            try {
                redirectTo = await completeNativeAuthorization({
                    env: e as { NATIVE_CLIENT_ENABLED?: string },
                    oauth, db: b.DB, authReq, clientName: 'Field App', ctx: undefined,
                    identity: { userId: who, tenantId: TENANT, role: 'inspector' },
                });
            } catch (err) {
                // The consent action lets a refusal Response propagate to the router.
                if (err instanceof Response) return err;
                throw err;
            }
        } else {
            ({ redirectTo } = await oauth.completeAuthorization({
                request: authReq, userId: who, scope: authReq.scope ?? [], metadata: { clientName: 'MCP' },
                props: { userId: who, tenantId: TENANT, tenantSlug: 'native', role: 'inspector', scopes: authReq.scope ?? [] },
            }));
        }
        return new Response(null, { status: 302, headers: { Location: redirectTo } });
    }
    if (url.pathname === '/__test/revoke-all') {
        await revokeAllUserGrants(oauth, url.searchParams.get('user') ?? USER);
        return new Response('ok');
    }
    if (url.pathname === '/__test/grants') {
        const { items } = await oauth.listUserGrants(url.searchParams.get('user') ?? USER);
        return Response.json(items.map((g) => ({ id: g.id, scope: g.scope, expiresAt: g.expiresAt ?? null })));
    }
    if (url.pathname === '/__test/grant-count') {
        const { items } = await oauth.listUserGrants(url.searchParams.get('user') ?? USER);
        return Response.json({ count: items.length });
    }
    return app.fetch(req, e as never, c);
}

const callIn = (e: Record<string, unknown>) => (req: Request) =>
    Promise.resolve(buildOAuthHandler(appOrConsent as never, e as never, req).fetch(req, e, ctx));
const call = callIn(env);
type Call = typeof call;

function b64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function registerClient(via: Call = call): Promise<string> {
    const res = await via(new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Field App',
            redirect_uris: [REDIRECT],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
        }),
    }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { client_id: string }).client_id;
}

const token = (form: Record<string, string>, via: Call = call) => via(new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
}));

/** Authorize with PKCE; returns the authorize response and the verifier. */
async function authorize(clientId: string, scope: string, via: Call, as = USER) {
    const { verifier, challenge } = await pkcePair();
    const authUrl = new URL(`${ORIGIN}/oauth/authorize`);
    authUrl.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 'st',
        code_challenge: challenge, code_challenge_method: 'S256', as,
    }).toString();
    return { authRes: await via(new Request(authUrl)), verifier };
}

/** Authorize with PKCE and exchange the code. Returns the raw token response. */
async function authorizeAndExchange(clientId: string, scope: string, as = USER, via: Call = call) {
    const { authRes, verifier } = await authorize(clientId, scope, via, as);
    expect(authRes.status).toBe(302);
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code');
    expect(code).toBeTruthy();
    return token({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }, via);
}

const sessionContext = (accessToken: string, via: Call = call) => via(new Request(`${ORIGIN}/api/session/context`, {
    headers: { Authorization: `Bearer ${accessToken}` },
}));

const mcpCall = (accessToken: string, via: Call) => via(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}));

const grantCount = async (user = USER) =>
    ((await (await call(new Request(`${ORIGIN}/__test/grant-count?user=${user}`))).json()) as { count: number }).count;

interface Tokens { access_token: string; refresh_token?: string; expires_in: number }

const refreshWith = (via: Call, clientId: string, t: Tokens) =>
    token({ grant_type: 'refresh_token', refresh_token: t.refresh_token!, client_id: clientId }, via);

describe('native client OAuth lifecycle (real provider)', () => {
    beforeAll(async () => {
        await replayMigrations(b.DB, migrationSql);
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)')
            .bind(TENANT, 'native', now).run();
        for (const id of [USER, OTHER_USER, GONE_USER, MULTI_USER, PW_USER, LEGACY_USER]) {
            await b.DB.prepare(
                'INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ).bind(id, TENANT, `${id}@example.com`, 'x', id, 'inspector', now).run();
        }
    });

    afterEach(() => vi.useRealTimers());

    it('with only MCP enabled, a scope=native authorization is refused and an MCP-scope one still works', async () => {
        const via = callIn(mcpOnlyEnv);
        const clientId = await registerClient(via);
        const refused = await authorize(clientId, 'native', via);
        expect(refused.authRes.status).toBe(404);
        expect(new URL(refused.authRes.headers.get('Location') ?? 'http://none.invalid').searchParams.get('code')).toBeNull();
        // Positive control: the same deployment, same client, MCP scope.
        const ok = await authorize(clientId, 'read:inspections', via);
        expect(ok.authRes.status).toBe(302);
        expect(new URL(ok.authRes.headers.get('Location')!).searchParams.get('code')).toBeTruthy();
    });

    it('a native-shaped token is refused by /api/* when NATIVE_CLIENT_ENABLED is unset, and works when set', async () => {
        const clientId = await registerClient();
        const t = (await (await authorizeAndExchange(clientId, 'native')).json()) as Tokens;
        expect((await sessionContext(t.access_token)).status).toBe(200);
        expect((await sessionContext(t.access_token, callIn(mcpOnlyEnv))).status).toBe(401);
    });

    it('issues a 1h access token and a refresh token; the access token reaches /api/*', async () => {
        const clientId = await registerClient();
        const res = await authorizeAndExchange(clientId, 'native');
        expect(res.status).toBe(200);
        const t = (await res.json()) as Tokens;
        expect(t.expires_in).toBe(3600);
        expect(t.refresh_token).toBeTruthy();

        expect((await sessionContext(t.access_token)).status).toBe(200);
        // Control: the same endpoint refuses a token the provider never issued.
        expect((await sessionContext('not-a-token')).status).toBe(401);
    });

    it('a token from an MCP-scope grant is refused by /api/*', async () => {
        const clientId = await registerClient();
        const res = await authorizeAndExchange(clientId, 'read:inspections');
        expect(res.status).toBe(200);
        const t = (await res.json()) as Tokens;
        expect(t.access_token).toBeTruthy();
        expect((await sessionContext(t.access_token)).status).toBe(401);
    });

    it('refresh slides the idle clock; 90+ idle days is 400 invalid_grant and revokes the grant', async () => {
        const clientId = await registerClient();
        const first = (await (await authorizeAndExchange(clientId, 'native')).json()) as Tokens;

        // Positive control: a refresh now succeeds and the new token works.
        const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token!, client_id: clientId });
        expect(refreshed.status).toBe(200);
        const second = (await refreshed.json()) as Tokens;
        expect(second.expires_in).toBe(3600);
        expect((await sessionContext(second.access_token)).status).toBe(200);

        // 89 idle days: still allowed, and the clock slides forward from here.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 89 * 86400 * 1000);
        const late = await token({ grant_type: 'refresh_token', refresh_token: second.refresh_token!, client_id: clientId });
        expect(late.status).toBe(200);
        const third = (await late.json()) as Tokens;

        // Past the limit measured from THAT refresh (not from the grant's birth).
        vi.setSystemTime(Date.now() + (NATIVE_IDLE_LIMIT_S + 86400) * 1000);
        const expired = await token({ grant_type: 'refresh_token', refresh_token: third.refresh_token!, client_id: clientId });
        expect(expired.status).toBe(400);
        expect(((await expired.json()) as { error: string }).error).toBe('invalid_grant');
        // The provider enforces the idle window itself (the refresh token's own expiry,
        // re-armed to 90 days on every refresh), so it refuses before the idle check in
        // nativeTokenExchange is reached. The refused grant is not revoked on the spot:
        // its record carries the same expiry and the store drops it, so the count is not
        // asserted here (it would need the store's clock, which a fake Date does not move).
        // The access token minted 90+ days ago is long past its own hour.
        expect((await sessionContext(third.access_token)).status).toBe(401);
        vi.useRealTimers();
        // Control: the grant is not unusable by nature; a new sign-in under the same user works.
        const again = await authorizeAndExchange(clientId, 'native');
        expect(again.status).toBe(200);
    });

    it('with the switch turned off, a native refresh is 400 invalid_grant and the grant is revoked; with it on it refreshes', async () => {
        const clientId = await registerClient();
        const kept = (await (await authorizeAndExchange(clientId, 'native', USER)).json()) as Tokens;
        const dropped = (await (await authorizeAndExchange(clientId, 'native', OTHER_USER)).json()) as Tokens;
        const refresh = (via: Call, t: Tokens) => via(new Request(`${ORIGIN}/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token!, client_id: clientId }).toString(),
        }));
        const usersBefore = await grantCount(USER);
        const othersBefore = await grantCount(OTHER_USER);

        // Switch off: refused, and the grant is gone rather than left to keep sliding.
        const off = await refresh(callIn(mcpOnlyEnv), dropped);
        expect(off.status).toBe(400);
        expect(((await off.json()) as { error: string }).error).toBe('invalid_grant');
        expect(await grantCount(OTHER_USER)).toBe(othersBefore - 1);

        // Control: the same refresh on the opted-in deployment succeeds and keeps its grant.
        const on = await refresh(call, kept);
        expect(on.status).toBe(200);
        expect(await grantCount(USER)).toBe(usersBefore);
    });

    it('a native-grant token presented to /mcp is refused with 403', async () => {
        const clientId = await registerClient();
        const t = (await (await authorizeAndExchange(clientId, 'native')).json()) as Tokens;
        const res = await call(new Request(`${ORIGIN}/mcp`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${t.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }));
        expect(res.status).toBe(403);
        // Control: an MCP grant's token gets past the same guard and reaches the MCP server.
        const mcp = (await (await authorizeAndExchange(clientId, 'read:inspections')).json()) as Tokens;
        expect((await mcpCall(mcp.access_token, call)).status).toBe(200);
    }, 60_000);

    it('the company in the URL must be the company of the grant: /mcp/{other} is 403 tenant_mismatch, /mcp/{own} is served', async () => {
        const clientId = await registerClient();
        const mcp = (await (await authorizeAndExchange(clientId, 'read:inspections')).json()) as Tokens;
        const at = (path: string) => call(new Request(`${ORIGIN}${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${mcp.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }));
        // The stand-in consent page above writes tenantSlug 'native' into MCP grants.
        const own = await at('/mcp/native');
        expect(own.status).toBe(200);
        const other = await at('/mcp/other-company');
        expect(other.status).toBe(403);
        expect(((await other.json()) as { error: string }).error).toBe('tenant_mismatch');
    }, 60_000);

    it('a grant that claims to be native but is not well-formed is refused at the token endpoint and revoked, never handed on as an MCP grant (positive control: a well-formed native grant exchanges)', async () => {
        const clientId = await registerClient();
        const before = await grantCount(LEGACY_USER);
        const { verifier, challenge } = await pkcePair();
        const authUrl = new URL(`${ORIGIN}/oauth/authorize`);
        authUrl.search = new URLSearchParams({
            response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'native', state: 'st',
            code_challenge: challenge, code_challenge_method: 'S256', as: LEGACY_USER, legacy: '1',
        }).toString();
        const authRes = await call(new Request(authUrl));
        expect(authRes.status).toBe(302);
        expect(await grantCount(LEGACY_USER)).toBe(before + 1);
        const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;
        const exchanged = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
        expect(exchanged.status).toBe(400);
        expect(((await exchanged.json()) as { error: string }).error).toBe('invalid_grant');
        expect(await grantCount(LEGACY_USER), 'the malformed grant is revoked').toBe(before);

        const ok = await authorizeAndExchange(clientId, 'native', LEGACY_USER);
        expect(ok.status).toBe(200);
    });

    it('revokeAllUserGrants cuts off every native grant of that user and leaves another user alone', async () => {
        const clientId = await registerClient();
        const mine = (await (await authorizeAndExchange(clientId, 'native', USER)).json()) as Tokens;
        const theirs = (await (await authorizeAndExchange(clientId, 'native', OTHER_USER)).json()) as Tokens;
        expect((await sessionContext(mine.access_token)).status).toBe(200);
        expect((await sessionContext(theirs.access_token)).status).toBe(200);

        await call(new Request(`${ORIGIN}/__test/revoke-all?user=${USER}`));

        expect((await sessionContext(mine.access_token)).status).toBe(401);
        expect(await grantCount(USER)).toBe(0);
        expect((await sessionContext(theirs.access_token)).status).toBe(200);
        expect(await grantCount(OTHER_USER)).toBe(1);
    });

    describe('the two switches are independent', () => {
        it('with only native clients on, an MCP grant is refused at the token endpoint; with MCP on it exchanges', async () => {
            const via = callIn(nativeOnlyEnv);
            const clientId = await registerClient(via);
            const before = await grantCount(OTHER_USER);
            const refused = await authorizeAndExchange(clientId, 'read:inspections', OTHER_USER, via);
            expect(refused.status).toBe(400);
            expect(((await refused.json()) as { error: string }).error).toBe('invalid_grant');
            // The refused grant was revoked rather than left behind.
            expect(await grantCount(OTHER_USER)).toBe(before);
            // Control: the same request on a deployment with MCP on is served.
            expect((await authorizeAndExchange(clientId, 'read:inspections', OTHER_USER)).status).toBe(200);
            await call(new Request(`${ORIGIN}/__test/revoke-all?user=${OTHER_USER}`));
        });

        it('with only native clients on, an MCP token minted while MCP was on is 404 at /mcp and cannot refresh', async () => {
            const clientId = await registerClient();
            const before = await grantCount(OTHER_USER);
            const mcp = (await (await authorizeAndExchange(clientId, 'read:inspections', OTHER_USER)).json()) as Tokens;
            expect(await grantCount(OTHER_USER)).toBe(before + 1);
            const nativeOnly = callIn(nativeOnlyEnv);
            expect((await mcpCall(mcp.access_token, nativeOnly)).status).toBe(404);
            const refreshed = await refreshWith(nativeOnly, clientId, mcp);
            expect(refreshed.status).toBe(400);
            expect(((await refreshed.json()) as { error: string }).error).toBe('invalid_grant');
            expect(await grantCount(OTHER_USER)).toBe(before);
        });

        it('with only native clients on, a native session works while /mcp stays 404; with MCP on the MCP token reaches the server', async () => {
            const nativeOnly = callIn(nativeOnlyEnv);
            const mcp = (await (await authorizeAndExchange(await registerClient(), 'read:inspections', MULTI_USER)).json()) as Tokens;
            const nativeTok = (await (await authorizeAndExchange(await registerClient(nativeOnly), 'native', USER, nativeOnly)).json()) as Tokens;
            expect((await mcpCall(mcp.access_token, nativeOnly)).status).toBe(404);
            expect((await sessionContext(nativeTok.access_token, nativeOnly)).status).toBe(200);
            // Control: with MCP on the guard lets the MCP token through to the server.
            expect((await mcpCall(mcp.access_token, call)).status).toBe(200);
            await call(new Request(`${ORIGIN}/__test/revoke-all?user=${MULTI_USER}`));
        });

        it('with both on, an MCP grant and a native grant work side by side', async () => {
            const nativeTok = (await (await authorizeAndExchange(await registerClient(), 'native', OTHER_USER)).json()) as Tokens;
            const mcpTok = (await (await authorizeAndExchange(await registerClient(), 'read:inspections', OTHER_USER)).json()) as Tokens;
            expect((await sessionContext(nativeTok.access_token)).status).toBe(200);
            expect(mcpTok.access_token).toBeTruthy();
            expect((await mcpCall(nativeTok.access_token, call)).status).toBe(403);
            await call(new Request(`${ORIGIN}/__test/revoke-all?user=${OTHER_USER}`));
        });
    });

    describe('refresh re-checks the member and the credential', () => {
        it('a removed member whose grant revocation failed cannot refresh: 400 invalid_grant and the grant is revoked', async () => {
            const clientId = await registerClient();
            const t = (await (await authorizeAndExchange(clientId, 'native', GONE_USER)).json()) as Tokens;
            // Control: while the member is active the refresh works.
            const ok = await refreshWith(call, clientId, t);
            expect(ok.status).toBe(200);
            const fresh = (await ok.json()) as Tokens;
            // Soft-delete the member and leave the grant in place (a failed revocation).
            await b.DB.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').bind(Date.now(), GONE_USER).run();
            try {
                expect(await grantCount(GONE_USER)).toBe(1);
                const refused = await refreshWith(call, clientId, fresh);
                expect(refused.status).toBe(400);
                expect(((await refused.json()) as { error: string }).error).toBe('invalid_grant');
                expect(await grantCount(GONE_USER)).toBe(0);
            } finally {
                await b.DB.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').bind(GONE_USER).run();
            }
        });

        it('a credential change after the grant (revocation failed) ends the access token and the refresh; an older marker changes nothing', async () => {
            const kv = testEnv.TENANT_CACHE as KVNamespace;
            const clientId = await registerClient();
            const t = (await (await authorizeAndExchange(clientId, 'native', PW_USER)).json()) as Tokens;
            const now = Math.floor(Date.now() / 1000); // seed-lint-ok: the pwchanged KV marker is epoch seconds, not a timestamp_ms column
            // Control: a marker from BEFORE the grant (the member signed in again afterwards) changes nothing.
            await kv.put(`pwchanged:${PW_USER}`, String(now - 600));
            expect((await sessionContext(t.access_token)).status).toBe(200);
            // A marker after the grant: both the access token and the refresh are refused.
            await kv.put(`pwchanged:${PW_USER}`, String(now + 600));
            try {
                expect((await sessionContext(t.access_token)).status).toBe(401);
                const refused = await refreshWith(call, clientId, t);
                expect(refused.status).toBe(400);
                expect(((await refused.json()) as { error: string }).error).toBe('invalid_grant');
                expect(await grantCount(PW_USER)).toBe(0);
            } finally {
                await kv.delete(`pwchanged:${PW_USER}`);
            }
        });
    });

    describe('refresh when the credential marker cannot be read', () => {
        /** The same deployment with a TENANT_CACHE whose reads fail; the provider's own OAUTH_KV is untouched. */
        const kvDownEnv = {
            ...env,
            TENANT_CACHE: { get: () => Promise.reject(new Error('kv unavailable')) },
        } as Record<string, unknown>;

        it('a marker that shows a credential change ends the grant (positive control for the case below)', async () => {
            const kv = testEnv.TENANT_CACHE as KVNamespace;
            const clientId = await registerClient();
            const t = (await (await authorizeAndExchange(clientId, 'native', PW_USER)).json()) as Tokens;
            await kv.put(`pwchanged:${PW_USER}`, String(Math.floor(Date.now() / 1000) + 600)); // seed-lint-ok: epoch-seconds KV marker
            try {
                const refused = await refreshWith(call, clientId, t);
                expect(refused.status).toBe(400);
                expect(((await refused.json()) as { error: string }).error).toBe('invalid_grant');
                expect(await grantCount(PW_USER)).toBe(0);
            } finally {
                await kv.delete(`pwchanged:${PW_USER}`);
            }
        });

        it('a marker that cannot be read answers a retryable 503, keeps the grant, and the same refresh token works once the store recovers', async () => {
            const clientId = await registerClient();
            const t = (await (await authorizeAndExchange(clientId, 'native', PW_USER)).json()) as Tokens;
            expect(await grantCount(PW_USER)).toBe(1);

            const transient = await refreshWith(callIn(kvDownEnv), clientId, t);
            expect(transient.status).toBe(503);
            expect(transient.headers.get('Retry-After')).toBeTruthy();
            expect(((await transient.json()) as { error: string }).error).toBe('temporarily_unavailable');
            // Not revoked: the grant is still there and the refresh token was not consumed.
            expect(await grantCount(PW_USER)).toBe(1);

            const recovered = await refreshWith(call, clientId, t);
            expect(recovered.status).toBe(200);
            expect(await grantCount(PW_USER)).toBe(1);
            await call(new Request(`${ORIGIN}/__test/revoke-all?user=${PW_USER}`));
        });
    });

    describe('grants are not bound to a device', () => {
        it('a second authorization under the same client_id leaves the first grant and its tokens valid', async () => {
            const clientId = await registerClient();
            const first = (await (await authorizeAndExchange(clientId, 'native', MULTI_USER)).json()) as Tokens;
            const second = (await (await authorizeAndExchange(clientId, 'native', MULTI_USER)).json()) as Tokens;
            expect(await grantCount(MULTI_USER)).toBe(2);
            expect((await sessionContext(first.access_token)).status).toBe(200);
            expect((await sessionContext(second.access_token)).status).toBe(200);
            expect((await refreshWith(call, clientId, first)).status).toBe(200);
            await call(new Request(`${ORIGIN}/__test/revoke-all?user=${MULTI_USER}`));
        });

        it('past the per-member cap the oldest grant is revoked and the newest keeps working', async () => {
            const clientId = await registerClient();
            const issued: Tokens[] = [];
            for (let i = 0; i < NATIVE_GRANTS_PER_USER_MAX + 1; i++) {
                issued.push((await (await authorizeAndExchange(clientId, 'native', MULTI_USER)).json()) as Tokens);
                // Creation time is in whole seconds; space the grants so "oldest" is unambiguous.
                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(Date.now() + 2000);
            }
            vi.useRealTimers();
            expect(await grantCount(MULTI_USER)).toBe(NATIVE_GRANTS_PER_USER_MAX);
            expect((await sessionContext(issued[0]!.access_token)).status).toBe(401);
            expect((await sessionContext(issued[NATIVE_GRANTS_PER_USER_MAX]!.access_token)).status).toBe(200);
            await call(new Request(`${ORIGIN}/__test/revoke-all?user=${MULTI_USER}`));
        });
    });

    describe('managing grants from the web session', () => {
        interface GrantRow { id: string; kind: string; clientName: string | null }

        async function sessionCookie(userId: string): Promise<string> {
            const keyring = await buildKeyring(testEnv as never);
            const jwt = await signJwt({ sub: userId, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT }, keyring);
            return `__Host-inspector_token=${jwt}`;
        }
        const grantsApi = (via: Call, userId: string, path = '/api/mcp/grants', init: RequestInit = {}) =>
            sessionCookie(userId).then((cookie) => via(new Request(`${ORIGIN}${path}`, { ...init, headers: { cookie } })));
        const listed = async (via: Call, userId: string): Promise<GrantRow[]> =>
            ((await (await grantsApi(via, userId)).json()) as { data: GrantRow[] }).data;

        it('with only native clients enabled, a member lists and revokes their own native grant and cannot touch another member grant', async () => {
            const clientId = await registerClient();
            const mine = (await (await authorizeAndExchange(clientId, 'native', USER)).json()) as Tokens;
            const theirs = (await (await authorizeAndExchange(clientId, 'native', OTHER_USER)).json()) as Tokens;
            // A second grant for the same user and client replaces the first, so the MCP grant gets its own client.
            const asMcp = (await (await authorizeAndExchange(await registerClient(), 'read:inspections', USER)).json()) as Tokens;
            expect(asMcp.access_token).toBeTruthy();
            const via = callIn(nativeOnlyEnv);

            const rows = await listed(via, USER);
            // Opaque tokens are userId:grantId:secret. Grants are no longer replaced per client, so pick this test's own.
            const nativeRow = rows.find((r) => r.id === mine.access_token.split(':')[1]);
            const mcpRow = rows.find((r) => r.kind === 'mcp');
            expect(nativeRow?.kind, 'the native grant is listed and labelled').toBe('native');
            expect(mcpRow, 'an MCP grant is still labelled mcp').toBeDefined();
            expect(rows).toHaveLength(await grantCount(USER));
            const theirRows = await listed(via, OTHER_USER);
            expect(theirRows.some((r) => rows.some((mine) => mine.id === r.id))).toBe(false);

            // Another member's grant id is not found for this caller, and their token keeps working.
            const foreign = await grantsApi(via, USER, `/api/mcp/grants/${theirRows[0]!.id}`, { method: 'DELETE' });
            expect(foreign.status).toBe(404);
            expect((await sessionContext(theirs.access_token)).status).toBe(200);

            // Positive control: the caller's own native grant is revoked and its token dies.
            expect((await sessionContext(mine.access_token)).status).toBe(200);
            const revoked = await grantsApi(via, USER, `/api/mcp/grants/${nativeRow!.id}`, { method: 'DELETE' });
            expect(revoked.status, await revoked.clone().text()).toBe(200);
            expect((await sessionContext(mine.access_token)).status).toBe(401);
            expect((await listed(via, USER)).some((r) => r.id === nativeRow!.id)).toBe(false);
        });

        it('with neither MCP nor native clients enabled, the grant routes answer 404', async () => {
            const via = callIn(neitherEnv);
            expect((await grantsApi(via, USER)).status).toBe(404);
            expect((await grantsApi(via, USER, '/api/mcp/grants/anything', { method: 'DELETE' })).status).toBe(404);
            // Control: the same request on the opted-in deployment is served.
            expect((await grantsApi(call, USER)).status).toBe(200);
        });
    });
    describe('provider 1.x behaviours', () => {
        const DAY = 86400;
        const nowSec = () => Math.floor(Date.now() / 1000); // seed-lint-ok: OAuth grant expiry is epoch seconds (provider contract), not a tenants.created_at value
        interface GrantRow { id: string; scope: string[]; expiresAt: number | null }
        const grantsOf = async (user: string): Promise<GrantRow[]> =>
            (await (await call(new Request(`${ORIGIN}/__test/grants?user=${user}`))).json()) as GrantRow[];
        const grantOf = async (t: Tokens, user: string) => (await grantsOf(user)).find((g) => g.id === t.access_token.split(':')[1])!;
        const KV = () => (testEnv as unknown as { OAUTH_KV: KVNamespace }).OAUTH_KV;
        const revokeAll = (user: string) => call(new Request(`${ORIGIN}/__test/revoke-all?user=${user}`));

        it('refresh lifetime: a native grant is finite at code exchange and re-armed to 90 idle days on refresh; an MCP grant keeps the 30-day default', async () => {
            const clientId = await registerClient();
            const first = (await (await authorizeAndExchange(clientId, 'native', USER)).json()) as Tokens;
            const atExchange = (await grantOf(first, USER)).expiresAt;
            expect(atExchange, 'a finite expiry, not "never"').not.toBeNull();
            expect(atExchange!).toBeGreaterThan(nowSec() + 399 * DAY);
            expect(atExchange!).toBeLessThanOrEqual(nowSec() + NATIVE_REFRESH_MAX_TTL_S + 60);

            const refreshed = (await (await refreshWith(call, clientId, first)).json()) as Tokens;
            const afterRefresh = (await grantOf(refreshed, USER)).expiresAt!;
            expect(Math.abs(afterRefresh - (nowSec() + NATIVE_IDLE_LIMIT_S))).toBeLessThan(120);

            // Control: an MCP grant does not take the native lifetime.
            const mcp = (await (await authorizeAndExchange(await registerClient(), 'read:inspections', OTHER_USER)).json()) as Tokens;
            const mcpExpiry = (await grantOf(mcp, OTHER_USER)).expiresAt!;
            expect(Math.abs(mcpExpiry - (nowSec() + 30 * DAY))).toBeLessThan(120);
            await revokeAll(USER);
            await revokeAll(OTHER_USER);
        });

        it('PKCE: the discovery document advertises S256 only, and a plain challenge is refused while S256 is served', async () => {
            const meta = await call(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
            expect(meta.status).toBe(200);
            expect(((await meta.json()) as { code_challenge_methods_supported: string[] }).code_challenge_methods_supported).toEqual(['S256']);

            const clientId = await registerClient();
            const plainUrl = new URL(`${ORIGIN}/oauth/authorize`);
            plainUrl.search = new URLSearchParams({
                response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'read:inspections', state: 'st',
                code_challenge: 'c'.repeat(43), code_challenge_method: 'plain', as: USER,
            }).toString();
            const refused = await call(new Request(plainUrl)).then((r) => r, () => null);
            expect((refused?.headers.get('Location') ?? '').includes('code='), 'no authorization code is issued for a plain challenge').toBe(false);
            // Control: the same request with S256 is served.
            expect((await authorize(clientId, 'read:inspections', call)).authRes.status).toBe(302);
        });

        it('discovery: one canonical resource, and the 401 challenge for a workspace endpoint points at its metadata', async () => {
            const prm = await call(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`));
            expect(prm.status).toBe(200);
            expect(((await prm.json()) as { resource: string }).resource).toBe(`${ORIGIN}/mcp`);
            // Both endpoint shapes challenge toward the same metadata document, so a client that follows the
            // challenge learns the canonical resource whichever URL it was configured with.
            for (const path of ['/mcp', '/mcp/native']) {
                const res = await call(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
                expect(res.status, path).toBe(401);
                expect(res.headers.get('www-authenticate'), path).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
            }
            // The per-workspace metadata path of the earlier provider no longer exists (a client that probes it
            // before following the challenge sees a plain 404 and falls back).
            expect((await call(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp/native`))).status).toBe(404);
        });

        it('an authorization whose resource names a workspace path is an OAuth invalid_target error, not a server error', async () => {
            const clientId = await registerClient();
            const { challenge } = await pkcePair();
            const base = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'read:inspections', state: 'st', code_challenge: challenge, code_challenge_method: 'S256', as: USER };
            const withResource = (resource: string) => {
                const u = new URL(`${ORIGIN}/oauth/authorize`);
                u.search = new URLSearchParams({ ...base, resource }).toString();
                return call(new Request(u)).then((r) => ({ status: r.status }), (e: unknown) => ({ error: (e as { code?: string }).code }));
            };
            expect(await withResource(`${ORIGIN}/mcp/native`)).toEqual({ error: 'invalid_target' });
            // Control: the canonical resource is served.
            expect(await withResource(`${ORIGIN}/mcp`)).toEqual({ status: 302 });
        });

        it('a grant bound to the old per-workspace resource cannot refresh: 400 invalid_grant or invalid_target, never a 500', async () => {
            const clientId = await registerClient();
            const t = (await (await authorizeAndExchange(clientId, 'read:inspections', MULTI_USER)).json()) as Tokens;
            // Control: while the grant carries the canonical resource, a refresh works.
            const ok = await refreshWith(call, clientId, t);
            expect(ok.status).toBe(200);
            const current = (await ok.json()) as Tokens;

            // Rewrite the stored record into the shape an earlier provider wrote for a workspace endpoint.
            const [userId, grantId] = current.access_token.split(':');
            const key = `grant:${userId}:${grantId}`;
            const stored = await KV().getWithMetadata<Record<string, unknown>>(key, 'json');
            expect(stored.value?.resource, 'the stored grant records the resource it is bound to').toBe(`${ORIGIN}/mcp`);
            await KV().put(key, JSON.stringify({ ...stored.value, resource: `${ORIGIN}/mcp/native` }), stored.metadata ? { metadata: stored.metadata } : undefined);

            for (const extra of [{}, { resource: `${ORIGIN}/mcp/native` }] as Array<Record<string, string>>) {
                const res = await token({ grant_type: 'refresh_token', refresh_token: current.refresh_token!, client_id: clientId, ...extra });
                expect(res.status).toBe(400);
                expect(['invalid_grant', 'invalid_target']).toContain(((await res.json()) as { error: string }).error);
            }
            await revokeAll(MULTI_USER);
        });

        it('the provider refuses a user id containing a colon (the id we mint never has one)', async () => {
            const clientId = await registerClient();
            const bad = await authorize(clientId, 'read:inspections', call, 'tenant:user').then((r) => r.authRes.status, () => 'threw');
            expect(bad === 'threw' || Number(bad) >= 400, 'a colon in the user id is refused').toBe(true);
            // Control: a plain id is served.
            expect((await authorize(clientId, 'read:inspections', call, USER)).authRes.status).toBe(302);
            await revokeAll(USER);
        });
    });
});
