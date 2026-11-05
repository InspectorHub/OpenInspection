/**
 * Two header rules for what the application serves to anyone, checked through the real application:
 *  - a response under /api/public/ that did not choose a cache policy is "no-store" (it carries tokens, links and personal details), while one
 *    that did (a brand asset) keeps its own;
 *  - a handler's own Content-Security-Policy is kept, so a stored brand asset keeps the sandbox policy instead of getting the page policy.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

describe('public API response headers', () => {
    let h: Harness;
    afterEach(() => h?.close());

    const get = async (path: string, env = h.env): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'public-api-headers' });
        const res = await app.request(path, {}, env, exec.ctx);
        await exec.settle();
        return res;
    };

    it('marks a public JSON response that chose no cache policy as no-store, and leaves other paths alone', async () => {
        h = await createHarness('standalone');
        const gate = await get('/api/public/report-gate/acme-email/00000000-0000-4000-8000-00000000ffff');
        expect(gate.headers.get('cache-control')).toBe('no-store');
        const status = await get('/status');
        expect(status.headers.get('cache-control')).not.toBe('no-store');
    });

    it('keeps the cache policy and the sandbox policy a brand asset chose for itself', async () => {
        h = await createHarness('standalone');
        const key = `${TENANT_ID}/branding/logo-abc123.svg`;
        const env = {
            ...h.env,
            PHOTOS: { get: async () => ({ body: new Response('<svg xmlns="http://www.w3.org/2000/svg"/>').body, httpMetadata: { contentType: 'image/svg+xml' }, httpEtag: '"e"' }) },
        } as unknown as typeof h.env;
        const res = await get(`/api/public/brand-asset?key=${encodeURIComponent(key)}`, env);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
        expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        // Control: a response that set no policy of its own still gets the page policy.
        const other = await get('/api/public/report-gate/acme-email/00000000-0000-4000-8000-00000000ffff');
        expect(other.headers.get('content-security-policy')).toContain('frame-ancestors');
    });
});
