// OI #308 — forgot-password and reset-password carried hand-written copies of
// login's SaaS bounce with no spec of their own. Both now read
// profile.loginRedirectBase; these are the cases login-saas-bounce.test.ts
// pins for /login, applied to the two routes that never had them.
import { describe, it, expect } from 'vitest';
import { loader as forgotLoader } from '~/routes/forgot-password';
import { loader as resetLoader } from '~/routes/reset-password';
import { createLoadContext } from '~/lib/load-context';

// Same shape as login-saas-bounce.test.ts: a hand-rolled request (happy-dom
// drops forbidden headers on a real Request) and the real context accessor.
function forgotArgs(env: Record<string, string>) {
    return { context: createLoadContext(env), params: {} } as unknown as Parameters<typeof forgotLoader>[0];
}

function resetArgs(env: Record<string, string>, token = 'tok') {
    return {
        request: { url: `http://app.example.com/reset-password?token=${token}`, headers: { get: () => null } },
        context: createLoadContext(env),
        params: {},
    } as unknown as Parameters<typeof resetLoader>[0];
}

describe('forgot-password loader — SaaS portal bounce', () => {
    it('saas with a portal base redirects to the portal forgot page', async () => {
        const res = await forgotLoader(forgotArgs({ APP_MODE: 'saas', PORTAL_API_URL: 'https://inspectorhub.io' }));
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).headers.get('Location')).toBe('https://inspectorhub.io/forgot-password');
    });

    it('strips a trailing slash off the portal base', async () => {
        const res = await forgotLoader(forgotArgs({ APP_MODE: 'saas', PORTAL_API_URL: 'https://inspectorhub.io/' }));
        expect((res as Response).headers.get('Location')).toBe('https://inspectorhub.io/forgot-password');
    });

    it('saas WITHOUT a portal base falls through to the local form', async () => {
        expect(await forgotLoader(forgotArgs({ APP_MODE: 'saas' }))).toBeNull();
    });

    it('standalone renders the local form even if the var is present', async () => {
        expect(await forgotLoader(forgotArgs({ PORTAL_API_URL: 'https://inspectorhub.io' }))).toBeNull();
    });
});

describe('reset-password loader — SaaS portal bounce', () => {
    it('saas with a portal base redirects to the portal forgot page', async () => {
        const res = await resetLoader(resetArgs({ APP_MODE: 'saas', PORTAL_API_URL: 'https://inspectorhub.io/' }));
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).headers.get('Location')).toBe('https://inspectorhub.io/forgot-password');
    });

    it('saas WITHOUT a portal base renders the local form with the token', async () => {
        expect(await resetLoader(resetArgs({ APP_MODE: 'saas' }, 'abc'))).toEqual({ token: 'abc' });
    });

    it('standalone renders the local form with the token', async () => {
        expect(await resetLoader(resetArgs({}, 'abc'))).toEqual({ token: 'abc' });
    });
});
