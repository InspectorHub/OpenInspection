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
import { NATIVE_IDLE_LIMIT_S } from '../../../server/lib/auth/native-token';
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
        if ((authReq.scope ?? []).includes('native')) {
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
    if (url.pathname === '/__test/grant-count') {
        const { items } = await oauth.listUserGrants(url.searchParams.get('user') ?? USER);
        return Response.json({ count: items.length });
    }
    return app.fetch(req, e as never, c);
}

const callIn = (e: Record<string, unknown>) => (req: Request) =>
    Promise.resolve(buildOAuthHandler(appOrConsent as never, e as never).fetch(req, e, ctx));
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
        for (const id of [USER, OTHER_USER, GONE_USER, MULTI_USER, PW_USER]) {
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
        const before = await grantCount();

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
        vi.useRealTimers();
        expect(await grantCount()).toBe(before - 1);
        // The revoked grant's access token no longer works.
        expect((await sessionContext(third.access_token)).status).toBe(401);
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
        // Control: an MCP grant's token gets past the same guard and reaches the MCP server. This
        // workers project has no INSPECTOR_MCP Durable Object, so reaching it surfaces as the
        // agent's missing-binding error; the native request above never got that far.
        const mcp = (await (await authorizeAndExchange(clientId, 'read:inspections')).json()) as Tokens;
        const reached = await call(new Request(`${ORIGIN}/mcp`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${mcp.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })).then((r) => (r.status === 403 ? 'forbidden' : 'answered'), (e: unknown) => String(e));
        expect(reached === 'answered' || reached.includes('INSPECTOR_MCP')).toBe(true);
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
            // Control: with MCP on the guard lets the MCP token through (this project has no MCP Durable Object).
            const reached = await mcpCall(mcp.access_token, call).then((r) => (r.status === 404 ? 'not-found' : 'answered'), (e: unknown) => String(e));
            expect(reached === 'answered' || reached.includes('INSPECTOR_MCP')).toBe(true);
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
});
