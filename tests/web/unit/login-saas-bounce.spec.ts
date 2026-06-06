// B-26 — SaaS deploys must bounce the /login PAGE to the portal (the API's
// POST /api/auth/login 410 LOGIN_MOVED_TO_PORTAL guard already covers the
// submit path; without the page bounce, app.<domain>/login renders a form
// that can never succeed).
import { describe, it, expect } from 'vitest';
import { loader } from '../../../app/routes/login';

type LoaderArgs = Parameters<typeof loader>[0];

function args(env: Record<string, string>, cookie?: string): LoaderArgs {
    return {
        request: new Request('http://app.example.com/login', cookie ? { headers: { Cookie: cookie } } : undefined),
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
        expect(res).toBeNull();
    });

    it('standalone mode renders the local form (no bounce)', async () => {
        const res = await loader(args({ PORTAL_API_URL: 'https://inspectorhub.io' }));
        expect(res).toBeNull();
    });
});
