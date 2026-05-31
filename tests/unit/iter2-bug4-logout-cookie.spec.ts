import { describe, it, expect } from 'vitest';

/**
 * iter-2 production bug #4 — `/api/auth/logout` did not fully terminate
 * the customer's session. The handler cleared `__Host-inspector_token`
 * but left `__Host-csrf_token` in place, so the CSRF cookie outlived the
 * session — a fixation vector if the token was exfiltrated pre-logout.
 *
 * The fix adds a second `deleteCookie` call alongside the auth-token
 * clear. Both cookies use the `__Host-` prefix, which the browser
 * silently rejects unless the deletion Set-Cookie carries `Secure` and
 * `Path=/` — these tests pin both the wire format and the production
 * route's behavior.
 */

describe('iter-2 #4 — logout cookie deletion contract', () => {
    it('a deletion cookie for __Host- prefix MUST carry Secure and Path=/', async () => {
        // Reproduce what hono/cookie's deleteCookie writes for the auth cookie.
        // The serializer is `cookie` (npm) under the hood; we don't need to
        // mock it — we just emit the same shape the helper produces and
        // assert on the wire format.
        const { deleteCookie } = await import('hono/cookie');
        const { Hono } = await import('hono');
        const app = new Hono();
        app.post('/logout', (c) => {
            deleteCookie(c, '__Host-inspector_token', { path: '/', secure: true, sameSite: 'Strict' });
            deleteCookie(c, '__Host-csrf_token', { path: '/', secure: true, sameSite: 'Strict' });
            return c.json({ success: true });
        });
        const res = await app.request('/logout', { method: 'POST' });
        const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
        // Browsers / fetch return an array of Set-Cookie headers — both must be present.
        expect(setCookieHeaders.length).toBeGreaterThanOrEqual(2);

        const inspectorCookie = setCookieHeaders.find(h => h.startsWith('__Host-inspector_token='));
        const csrfCookie = setCookieHeaders.find(h => h.startsWith('__Host-csrf_token='));
        expect(inspectorCookie).toBeDefined();
        expect(csrfCookie).toBeDefined();

        // Both deletion cookies must carry Secure + Path=/ — `__Host-` cookies
        // are silently ignored by the browser otherwise, leaving the live
        // cookie in place and BUG #4 reappearing.
        for (const cookie of [inspectorCookie!, csrfCookie!]) {
            expect(cookie).toMatch(/Path=\//i);
            expect(cookie).toMatch(/Secure/i);
            // Max-Age=0 OR an Expires date in the past — either is a valid deletion.
            expect(cookie).toMatch(/(Max-Age=0|Expires=)/i);
        }
    });

    it('production logout helper deletes BOTH __Host-inspector_token AND __Host-csrf_token', async () => {
        // Pin the production behavior by importing the actual helper used by
        // the logout handler. If somebody removes the second deleteCookie
        // call, this test breaks immediately.
        const auth = await import('../../server/api/auth');
        // The module exports `default` (coreAuthRoutes). We verify that the
        // logout handler is wired by sending a synthetic request through the
        // Hono router and reading the resulting Set-Cookie headers.
        //
        // The handler invokes `c.var.services.auth.invalidateUserSessions(user.sub)`
        // when a user is in context — we omit the user binding so that side
        // effect is skipped, leaving only the cookie clears under test.
        const res = await auth.default.request('/logout', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        });
        const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
        const inspectorCookie = setCookieHeaders.find(h => h.startsWith('__Host-inspector_token='));
        const csrfCookie = setCookieHeaders.find(h => h.startsWith('__Host-csrf_token='));
        expect(inspectorCookie, 'logout did not clear __Host-inspector_token').toBeDefined();
        expect(csrfCookie, 'logout did not clear __Host-csrf_token').toBeDefined();
    });
});
