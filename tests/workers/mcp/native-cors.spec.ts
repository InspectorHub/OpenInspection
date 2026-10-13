/**
 * The OAuth endpoints a native app calls from its WebView (dynamic registration
 * and the token endpoint) are answered by the OAuth provider library, which adds
 * its own CORS headers. This pins that the two WebView origins get them on the
 * preflight AND on the real response, through the real provider in workerd.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../../../server/index';
import { buildOAuthHandler } from '../../../server/lib/mcp/oauth-provider';

const SERVER = 'https://x.test';
const WEBVIEW_ORIGINS = ['capacitor://localhost', 'https://localhost'];
const env = { ...testEnv, APP_MODE: 'standalone', NATIVE_CLIENT_ENABLED: 'true' } as unknown as Record<string, unknown>;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const appFetch = (r: Request, e: Record<string, unknown>, c: ExecutionContext) => app.fetch(r, e as never, c);
const call = (req: Request) =>
    Promise.resolve(buildOAuthHandler(appFetch as never, env as never).fetch(req, env, ctx));

const tokenRequest = (headers: Record<string, string>) => new Request(`${SERVER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: 'bogus', client_id: 'nope' }).toString(),
});

describe('native WebView origins on the OAuth endpoints (real provider)', () => {
    for (const origin of WEBVIEW_ORIGINS) {
        for (const path of ['/oauth/token', '/oauth/register']) {
            it(`${origin} preflight to ${path} is allowed with Authorization`, async () => {
                const res = await call(new Request(`${SERVER}${path}`, {
                    method: 'OPTIONS',
                    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
                }));
                expect(res.status).toBeLessThan(300);
                expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
                expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('authorization');
                expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
            });
        }

        it(`${origin} can register a client and read the answer`, async () => {
            const res = await call(new Request(`${SERVER}/oauth/register`, {
                method: 'POST',
                headers: { Origin: origin, 'content-type': 'application/json' },
                body: JSON.stringify({
                    client_name: 'Field App', redirect_uris: ['io.example.fieldapp:/oauth/callback'],
                    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
                }),
            }));
            expect(res.status).toBe(201);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
            expect(((await res.json()) as { client_id?: string }).client_id).toBeTruthy();
        });

        it(`${origin} can read a token endpoint error (the request reaches real OAuth handling)`, async () => {
            const res = await call(tokenRequest({ Origin: origin }));
            expect(res.status).toBe(401);
            expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
            expect(((await res.json()) as { error?: string }).error).toBe('invalid_client');
        });
    }

    it('control: the same token request with no Origin is handled identically but carries no CORS headers', async () => {
        const res = await call(tokenRequest({}));
        expect(res.status).toBe(401);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
});
