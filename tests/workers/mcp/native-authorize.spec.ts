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
import { completeNativeAuthorization } from '../../../server/lib/auth/native-consent';
import { revokeAllUserGrants } from '../../../server/lib/mcp/grants';
import { NATIVE_IDLE_LIMIT_S } from '../../../server/lib/auth/native-token';
import { applyMigrations as replayMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const TENANT = 'native-tenant';
const USER = 'native-user';
const OTHER_USER = 'native-other-user';
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
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/**
 * Stands in for the consent page's action, plus two test-only probes that need
 * the provider helpers the library injects into the request env.
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

const token = (form: Record<string, string>) => call(new Request(`${ORIGIN}/oauth/token`, {
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
async function authorizeAndExchange(clientId: string, scope: string, as = USER) {
    const { authRes, verifier } = await authorize(clientId, scope, call, as);
    expect(authRes.status).toBe(302);
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code');
    expect(code).toBeTruthy();
    return token({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
}

const sessionContext = (accessToken: string, via: Call = call) => via(new Request(`${ORIGIN}/api/session/context`, {
    headers: { Authorization: `Bearer ${accessToken}` },
}));

const grantCount = async (user = USER) =>
    ((await (await call(new Request(`${ORIGIN}/__test/grant-count?user=${user}`))).json()) as { count: number }).count;

interface Tokens { access_token: string; refresh_token?: string; expires_in: number }

describe('native client OAuth lifecycle (real provider)', () => {
    beforeAll(async () => {
        await replayMigrations(b.DB, migrationSql);
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)')
            .bind(TENANT, 'native', now).run();
        for (const id of [USER, OTHER_USER]) {
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
});
