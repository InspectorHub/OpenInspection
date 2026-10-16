// When no trustworthy origin can be derived, the OAuth wrapper must degrade
// narrowly: the OAuth and MCP paths answer 503, everything else is served as usual.
// (The provider package is aliased to a stub in this suite; the real one is
// exercised in tests/workers/mcp.)
import { describe, it, expect, vi } from 'vitest';
import { buildOAuthHandler } from '../../../server/lib/mcp/oauth-provider';

const ctx = {} as ExecutionContext;
const page = vi.fn(async () => new Response('page', { status: 200 }));

const request = (path: string) => new Request(`http://192.168.1.5:8787${path}`);

describe('OAuth wrapper without a usable origin', () => {
    const env = { MCP_ENABLED: 'true', APP_BASE_URL: 'http://192.168.1.5:8787' };

    it('serves ordinary pages untouched', async () => {
        const res = await buildOAuthHandler(page, env, request('/')).fetch(request('/'), env, ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('page');
    });

    it('answers 503 on the OAuth and MCP surface instead of throwing', async () => {
        for (const path of ['/mcp', '/mcp/acme', '/oauth/token', '/.well-known/oauth-authorization-server']) {
            const res = await buildOAuthHandler(page, env, request(path)).fetch(request(path), env, ctx);
            expect(res.status, path).toBe(503);
        }
    });

    it('control: with an https origin the same paths reach the provider', async () => {
        const good = { MCP_ENABLED: 'true', APP_BASE_URL: 'https://app.example.com' };
        const res = await buildOAuthHandler(page, good, request('/mcp')).fetch(request('/mcp'), good, ctx);
        // The stub provider answers 501; what matters is that it is not the 503 above.
        expect(res.status).toBe(501);
    });

    it('control: with both flags off nothing is mounted whatever the origin', async () => {
        const off = { APP_BASE_URL: 'http://192.168.1.5:8787' };
        const res = await buildOAuthHandler(page, off, request('/mcp')).fetch(request('/mcp'), off, ctx);
        expect(res.status).toBe(200);
    });
});
