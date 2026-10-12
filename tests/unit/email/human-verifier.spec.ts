/**
 * Who may present a Turnstile token: only the web app's own in-process relay.
 * An API or MCP caller that sets the header itself is ignored.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildHumanVerifier } from '../../../server/lib/email/human-verifier';
import { REQUEST_SCOPE, createRequestScope } from '../../../server/lib/request-scope';

afterEach(() => { vi.unstubAllGlobals(); });

const ctx = (headers: Record<string, string>, env: Record<string, unknown>) => {
    const vars = new Map<string, unknown>();
    return {
        env,
        req: { header: (k: string) => headers[k.toLowerCase()] },
        set: (k: string, v: unknown) => { vars.set(k, v); },
        vars,
    };
};
const inProcess = () => ({ APP_MODE: 'saas', TURNSTILE_SECRET_KEY: 'real-secret', [REQUEST_SCOPE]: createRequestScope() });
const external = { APP_MODE: 'saas', TURNSTILE_SECRET_KEY: 'real-secret' };
const siteverify = (success: boolean) => vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 }));

describe('buildHumanVerifier', () => {
    it('ignores a token header on an external request, and never calls Cloudflare', async () => {
        const f = siteverify(true);
        vi.stubGlobal('fetch', f);
        const c = ctx({ 'x-turnstile-token': 'a'.repeat(20) }, external);
        expect(buildHumanVerifier(c as never)).toBeUndefined();
        expect(c.vars.has('humanVerified')).toBe(false);
        expect(f).not.toHaveBeenCalled();
    });

    it('offers no verifier when the in-process request carries no token', () => {
        expect(buildHumanVerifier(ctx({}, inProcess()) as never)).toBeUndefined();
    });

    it('verifies once and memoises, for an in-process request with a token', async () => {
        const f = siteverify(true);
        vi.stubGlobal('fetch', f);
        const c = ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess());
        const v = buildHumanVerifier(c as never)!;
        expect(await v()).toBe(true);
        expect(await v()).toBe(true);
        expect(f).toHaveBeenCalledTimes(1);
        expect(c.vars.get('humanVerified')).toBe(v);
    });

    it('reads a rejected token, and a failing siteverify, as not a person', async () => {
        vi.stubGlobal('fetch', siteverify(false));
        expect(await buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess()) as never)!()).toBe(false);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
        expect(await buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess()) as never)!()).toBe(false);
    });
});

describe('buildHumanVerifier across the in-process calls of one page action', () => {
    it('shares one siteverify between separate API calls that carry the same token', async () => {
        const f = siteverify(true);
        vi.stubGlobal('fetch', f);
        const env = inProcess();
        const first = buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, env) as never)!;
        const second = buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, env) as never)!;
        expect(await first()).toBe(true);
        expect(await second()).toBe(true);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('does not cache a transient siteverify failure as "not a person"', async () => {
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            if (++n === 1) throw new Error('network blip');
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }));
        const v = buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess()) as never)!;
        expect(await v()).toBe(true);
        expect(n).toBe(2);
    });

    it('treats a throttled or failing siteverify (429 / 5xx) as could-not-tell and tries again', async () => {
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async () => (++n === 1
            ? new Response('busy', { status: 503 })
            : new Response(JSON.stringify({ success: true }), { status: 200 }))));
        const v = buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess()) as never)!;
        expect(await v()).toBe(true);
        expect(n).toBe(2);
    });

    it('keeps the retried answer for later and concurrent callers instead of redeeming the token again', async () => {
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            n += 1;
            if (n === 1) throw new Error('blip');
            return new Response(JSON.stringify({ success: n === 2 }), { status: 200 });
        }));
        const v = buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess()) as never)!;
        const [a, b] = await Promise.all([v(), v()]);
        expect([a, b, await v()]).toEqual([true, true, true]);
        expect(n).toBe(2);
    });
});
