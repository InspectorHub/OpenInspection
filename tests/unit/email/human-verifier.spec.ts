/**
 * Who may present a Turnstile token: only the web app's own in-process relay.
 * An API or MCP caller that sets the header itself is ignored.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildHumanVerifier } from '../../../server/lib/email/human-verifier';
import { REQUEST_SCOPE } from '../../../server/lib/request-scope';

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
const inProcess = { APP_MODE: 'saas', TURNSTILE_SECRET_KEY: 'real-secret', [REQUEST_SCOPE]: { once: (_k: string, fn: () => Promise<unknown>) => fn() } };
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
        expect(buildHumanVerifier(ctx({}, inProcess) as never)).toBeUndefined();
    });

    it('verifies once and memoises, for an in-process request with a token', async () => {
        const f = siteverify(true);
        vi.stubGlobal('fetch', f);
        const c = ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess);
        const v = buildHumanVerifier(c as never)!;
        expect(await v()).toBe(true);
        expect(await v()).toBe(true);
        expect(f).toHaveBeenCalledTimes(1);
        expect(c.vars.get('humanVerified')).toBe(v);
    });

    it('reads a rejected token, and a failing siteverify, as not a person', async () => {
        vi.stubGlobal('fetch', siteverify(false));
        expect(await buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess) as never)!()).toBe(false);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
        expect(await buildHumanVerifier(ctx({ 'x-turnstile-token': 'a'.repeat(20) }, inProcess) as never)!()).toBe(false);
    });
});
