/**
 * A native refresh refused because the member was removed says so, against the REAL
 * OAuth provider in workerd. Two routes lead there: the grants are revoked first (the
 * provider then answers "grant not found"), or the revoke failed and the refresh
 * re-reads the member row. Both must carry `session_end_reason`; every other refusal
 * and every healthy refresh must not.
 *
 * The consent page is stood in by a small handler that calls the same
 * completeNativeAuthorization the real action does (see native-authorize.spec.ts).
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { buildOAuthHandler } from '../../../server/lib/mcp/oauth-provider';
import { completeNativeAuthorization } from '../../../server/lib/auth/native-consent';
import { revokeAllUserGrants } from '../../../server/lib/mcp/grants';
import { applyMigrations as replayMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const TENANT = 'end-tenant';
const REMOVED = 'end-removed-user';
const SOFT_DELETED = 'end-deleted-user';
const BYSTANDER = 'end-bystander-user';
const EXPIRED = 'end-expired-user';
const HEALTHY = 'end-healthy-user';
const REDIRECT = 'io.example.fieldapp:/oauth/callback';
const ORIGIN = 'https://x.test';

const b = testEnv as unknown as { DB: D1Database };
const env = { ...testEnv, APP_MODE: 'standalone', NATIVE_CLIENT_ENABLED: 'true' } as unknown as Record<string, unknown>;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function consent(req: Request, e: Record<string, unknown>): Promise<Response> {
    const url = new URL(req.url);
    const oauth = e.OAUTH_PROVIDER as OAuthHelpers;
    if (url.pathname === '/oauth/authorize') {
        const authReq: AuthRequest = await oauth.parseAuthRequest(req);
        const redirectTo = await completeNativeAuthorization({
            env: e as { NATIVE_CLIENT_ENABLED?: string },
            oauth, db: b.DB, authReq, clientName: 'Field App', ctx: undefined,
            identity: { userId: url.searchParams.get('as')!, tenantId: TENANT, role: 'inspector' },
        });
        return new Response(null, { status: 302, headers: { Location: redirectTo } });
    }
    if (url.pathname === '/__test/revoke-all') {
        const end = url.searchParams.get('end') === '1';
        await revokeAllUserGrants(oauth, url.searchParams.get('user')!, end ? { kv: testEnv.TENANT_CACHE as KVNamespace, reason: 'member_removed' } : undefined);
        return new Response('ok');
    }
    return new Response('not found', { status: 404 });
}

const call = (req: Request) => Promise.resolve(buildOAuthHandler(consent as never, env as never, req).fetch(req, env, ctx));

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const token = (form: Record<string, string>) => call(new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
}));

async function signIn(clientId: string, as: string): Promise<{ access_token: string; refresh_token: string }> {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const authUrl = new URL(`${ORIGIN}/oauth/authorize`);
    authUrl.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'native', state: 'st',
        code_challenge: challenge, code_challenge_method: 'S256', as,
    }).toString();
    const authRes = await call(new Request(authUrl));
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;
    const res = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    expect(res.status).toBe(200);
    return (await res.json()) as { access_token: string; refresh_token: string };
}

const refresh = async (clientId: string, t: { refresh_token: string }) => {
    const res = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('native refresh says why the session ended', () => {
    let clientId = '';
    beforeAll(async () => {
        await replayMigrations(b.DB, migrationSql);
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'endtenant', now).run();
        for (const id of [REMOVED, SOFT_DELETED, BYSTANDER, EXPIRED, HEALTHY]) {
            await b.DB.prepare('INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(id, TENANT, `${id}@example.com`, 'x', id, 'inspector', now).run();
        }
        const reg = await call(new Request(`${ORIGIN}/oauth/register`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: 'Field App', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
        }));
        clientId = ((await reg.json()) as { client_id: string }).client_id;
    });

    it('grants revoked because the member was removed: refresh is 400 invalid_grant with the reason, and again on a second try', async () => {
        const t = await signIn(clientId, REMOVED);
        await call(new Request(`${ORIGIN}/__test/revoke-all?user=${REMOVED}&end=1`));
        for (let i = 0; i < 2; i++) {
            const r = await refresh(clientId, t);
            expect(r.status).toBe(400);
            expect(r.body.error).toBe('invalid_grant');
            expect(r.body.session_end_reason).toBe('member_removed');
        }
    });

    it('member row gone but the revoke failed: the refresh re-read refuses with the reason', async () => {
        const t = await signIn(clientId, SOFT_DELETED);
        await b.DB.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').bind(Date.now(), SOFT_DELETED).run();
        const r = await refresh(clientId, t);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_grant');
        expect(r.body.session_end_reason).toBe('member_removed');
    });

    it('CONTROL: a grant revoked with no reason, and a healthy grant, carry no session_end_reason; another member removal does not leak', async () => {
        const bystander = await signIn(clientId, BYSTANDER);
        const expired = await signIn(clientId, EXPIRED);
        const healthy = await signIn(clientId, HEALTHY);
        const removed = await signIn(clientId, REMOVED);
        await call(new Request(`${ORIGIN}/__test/revoke-all?user=${REMOVED}&end=1`));
        expect((await refresh(clientId, removed)).body.session_end_reason).toBe('member_removed');

        await call(new Request(`${ORIGIN}/__test/revoke-all?user=${EXPIRED}`));
        const gone = await refresh(clientId, expired);
        expect(gone.status).toBe(400);
        expect(gone.body).toEqual({ error: 'invalid_grant', error_description: 'Grant not found' });

        const ok = await refresh(clientId, healthy);
        expect(ok.status).toBe(200);
        expect('session_end_reason' in ok.body).toBe(false);
        const stillOk = await refresh(clientId, bystander);
        expect(stillOk.status).toBe(200);
        expect('session_end_reason' in stillOk.body).toBe(false);
    });
});
