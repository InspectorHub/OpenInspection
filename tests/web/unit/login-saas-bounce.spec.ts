// B-26 — SaaS deploys must bounce the /login PAGE to the portal (the API's
// POST /api/auth/login 410 LOGIN_MOVED_TO_PORTAL guard already covers the
// submit path; without the page bounce, app.<domain>/login renders a form
// that can never succeed).
//
// Also covers B3: the standalone login loader honors a same-origin `returnTo`
// (the OAuth consent loader bounces unauthenticated users here with it).
import { describe, it, expect } from 'vitest';
import { loader } from '../../../app/routes/login';

type LoaderArgs = Parameters<typeof loader>[0];

// happy-dom enforces the Fetch spec's forbidden-header list and silently drops a
// `Cookie` header set on `new Request(...)`, so we hand-roll a minimal request
// object whose `headers.get('Cookie')` we fully control (the loader only reads
// `request.url` and `request.headers.get('Cookie')`).
function args(env: Record<string, string>, opts: { cookie?: string; returnTo?: string } = {}): LoaderArgs {
    const url = new URL('http://app.example.com/login');
    if (opts.returnTo != null) url.searchParams.set('returnTo', opts.returnTo);
    const request = {
        url: url.toString(),
        headers: {
            get: (name: string) =>
                name.toLowerCase() === 'cookie' ? (opts.cookie ?? null) : null,
        },
    };
    return {
        request,
        context: { cloudflare: { env } },
        params: {},
    } as unknown as LoaderArgs;
}

describe('login loader — SaaS portal bounce (B-26)', () => {
    it('saas mode with PORTAL_API_URL redirects to the portal login', async () => {
        const res = await loader(args({ APP_MODE: 'saas', PORTAL_API_URL: 'https://inspectorhub.io' }));
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).status).toBe(302);
        expect((res as Response).headers.get('Location')).toBe('https://inspectorhub.io/login');
    });

    it('strips a trailing slash off PORTAL_API_URL', async () => {
        const res = await loader(args({ APP_MODE: 'saas', PORTAL_API_URL: 'https://inspectorhub.io/' }));
        expect((res as Response).headers.get('Location')).toBe('https://inspectorhub.io/login');
    });

    it('saas mode WITHOUT PORTAL_API_URL falls through to the local form (fail-open, matches the API guard)', async () => {
        const res = await loader(args({ APP_MODE: 'saas' }));
        expect(res).toEqual({ returnTo: null });
    });

    it('standalone mode renders the local form (no bounce)', async () => {
        const res = await loader(args({ PORTAL_API_URL: 'https://inspectorhub.io' }));
        expect(res).toEqual({ returnTo: null });
    });
});

describe('login loader — returnTo (B3)', () => {
    it('passes a same-origin returnTo through to the form (unauthenticated)', async () => {
        const res = await loader(args({}, { returnTo: '/oauth/authorize?client_id=abc&scope=read' }));
        expect(res).toEqual({ returnTo: '/oauth/authorize?client_id=abc&scope=read' });
    });

    it('redirects an already-authenticated user to the same-origin returnTo', async () => {
        const res = await loader(
            args({}, { cookie: '__Host-inspector_token=fake.jwt.value', returnTo: '/oauth/authorize?x=1' }),
        );
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).headers.get('Location')).toBe('/oauth/authorize?x=1');
    });

    it('ignores an off-origin returnTo for an authenticated user (no open redirect)', async () => {
        const res = await loader(
            args({}, { cookie: '__Host-inspector_token=fake.jwt.value', returnTo: '//evil.test/phish' }),
        );
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).headers.get('Location')).toBe('/inspections');
    });
});
