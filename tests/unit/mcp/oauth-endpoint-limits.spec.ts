// The OAuth provider answers /oauth/register and /oauth/token itself, so a limit has to wrap it. (The provider package is aliased to a stub
// in this suite, which answers 501; what matters is whether the request reaches it.)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildOAuthHandler } from '../../../server/lib/mcp/oauth-provider';
import { limitedOAuthDoor } from '../../../server/lib/mcp/endpoint-limits';

const ctx = {} as ExecutionContext;
const page = async () => new Response('page', { status: 200 });

function setup(allow: boolean, allowToken = allow) {
    const keys: string[] = [];
    const env = {
        MCP_ENABLED: 'true',
        APP_BASE_URL: 'https://app.example.com',
        RATE_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow }; } },
        OAUTH_TOKEN_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(`token-binding|${key}`); return { success: allowToken }; } },
    };
    const call = (method: string, path: string, ip = '198.51.100.7') => {
        const req = new Request(`https://app.example.com${path}`, { method, headers: { 'CF-Connecting-IP': ip } });
        return buildOAuthHandler(page, env, req).fetch(req, env, ctx);
    };
    return { keys, call };
}

describe('the OAuth provider doors', () => {
    it('names exactly the two POST doors', () => {
        expect(limitedOAuthDoor('POST', '/oauth/register')).toBe('oauth-register');
        expect(limitedOAuthDoor('POST', '/oauth/token')).toBe('oauth-token');
        for (const [method, path] of [['GET', '/oauth/register'], ['GET', '/oauth/token'], ['POST', '/oauth/authorize'], ['POST', '/mcp'], ['POST', '/oauth/register/x']] as const) {
            expect(limitedOAuthDoor(method, path), `${method} ${path}`).toBeNull();
        }
    });

    it('answers 429 with Retry-After to a registration or token request over the limit, per caller address', async () => {
        const { keys, call } = setup(false);
        for (const path of ['/oauth/register', '/oauth/token']) {
            const res = await call('POST', path);
            expect(res.status, path).toBe(429);
            expect(res.headers.get('retry-after')).toBe('60');
            // An OAuth error object (RFC 6749 section 5.2), not a bespoke body.
            expect(await res.json()).toEqual({ error: 'temporarily_unavailable' });
            expect(res.headers.get('content-type')).toContain('application/json');
        }
        expect(keys).toEqual(['oauth-register:198.51.100.7', 'token-binding|oauth-token:198.51.100.7']);
    });

    it('counts token exchanges on their own binding: registration stays at its limit while token requests are not held to it', async () => {
        // The default binding refuses everything; the token binding allows. Registration is refused, the token request passes.
        const { call } = setup(false, true);
        expect((await call('POST', '/oauth/register')).status).toBe(429);
        expect((await call('POST', '/oauth/token')).status).toBe(501);
        // And the token binding can refuse on its own while registration passes.
        const tokenOnly = setup(true, false);
        expect((await tokenOnly.call('POST', '/oauth/register')).status).toBe(501);
        expect((await tokenOnly.call('POST', '/oauth/token')).status).toBe(429);
    });

    it('lets the same requests reach the provider within the limit, and never asks about other requests', async () => {
        const { keys, call } = setup(true);
        expect((await call('POST', '/oauth/register')).status).toBe(501);
        expect((await call('POST', '/oauth/token')).status).toBe(501);
        keys.length = 0;
        // Control: a limiter that rejects everything does not touch these.
        const refusing = setup(false);
        expect((await refusing.call('GET', '/oauth/token')).status).toBe(501);
        expect((await refusing.call('GET', '/.well-known/oauth-authorization-server')).status).not.toBe(429);
        expect(refusing.keys).toEqual([]);
    });
});

describe('a deployment without the token binding', () => {
    afterEach(() => vi.restoreAllMocks());

    /** A fresh copy of the modules, because the warning is once per isolate (module state). */
    async function fresh(withBinding: boolean) {
        vi.resetModules();
        const { logger } = await import('../../../server/lib/logger');
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const { buildOAuthHandler: build } = await import('../../../server/lib/mcp/oauth-provider');
        const env = {
            MCP_ENABLED: 'true',
            APP_BASE_URL: 'https://app.example.com',
            RATE_LIMITER: { limit: async () => ({ success: true }) },
            ...(withBinding ? { OAUTH_TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) } } : {}),
        };
        const call = (path: string) => {
            const req = new Request(`https://app.example.com${path}`, { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.7' } });
            return build(page, env, req).fetch(req, env, ctx);
        };
        return { warn, call };
    }

    it('says so once per isolate on the token door, and still lets the request through', async () => {
        const { warn, call } = await fresh(false);
        await call('/oauth/register');
        expect(warn).not.toHaveBeenCalled();
        expect((await call('/oauth/token')).status).toBe(501);
        await call('/oauth/token');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('OAUTH_TOKEN_RATE_LIMITER');
    });

    it('control: with the binding present nothing is logged', async () => {
        const { warn, call } = await fresh(true);
        await call('/oauth/token');
        expect(warn).not.toHaveBeenCalled();
    });
});
