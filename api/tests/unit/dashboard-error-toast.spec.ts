/**
 * Iter-2 soft-error pages — Bug #15 — unauthorized_role error toast.
 *
 * `htmlAuthGuard` redirects to `/dashboard?error=unauthorized_role` when a
 * user without an allowed role tries to deep-link an admin/inspector page.
 * The dashboard previously left the URL param dangling without surfacing
 * any UI feedback, leaving the user confused about what just happened.
 *
 * This spec exercises the new helpers added to `public/js/dashboard.js`:
 *
 *   - `mapDashboardErrorMessage(code)` — code → friendly toast string
 *   - `consumeDashboardErrorParam(win)` — read the param, strip from URL,
 *     return the resolved message
 *
 * The helpers are exposed on `window` so the DOMContentLoaded handler can
 * call them and so this test can drive them in isolation.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface DashWindow {
    mapDashboardErrorMessage: (code: string | null | undefined) => string | null;
    consumeDashboardErrorParam: (win: { location: { search: string; pathname: string; hash: string }; history: { replaceState: (s: unknown, t: string, url: string) => void } }) => string | null;
}

describe('dashboard error-param helpers (public/js/dashboard.js)', () => {
    let dash: DashWindow;

    beforeAll(() => {
        const code = readFileSync(
            join(process.cwd(), 'public', 'js', 'dashboard.js'),
            'utf8',
        );
        const fakeWindow: Record<string, unknown> = {};
        const fakeDocument = {
            addEventListener: () => {},
            getElementById: () => null,
            querySelector: () => null,
            createElement: () => ({ textContent: '', innerHTML: '', className: '', style: {} }),
            body: { appendChild: () => {} },
        };
        // Wrap the script so it executes against our fake window/document.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const fn = new Function('window', 'document', 'authFetch', 'logout', 'showToast', code);
        fn(
            fakeWindow,
            fakeDocument,
            () => Promise.resolve(new Response()),
            () => {},
            () => {},
        );
        dash = {
            mapDashboardErrorMessage: fakeWindow.mapDashboardErrorMessage as DashWindow['mapDashboardErrorMessage'],
            consumeDashboardErrorParam: fakeWindow.consumeDashboardErrorParam as DashWindow['consumeDashboardErrorParam'],
        };
        if (typeof dash.mapDashboardErrorMessage !== 'function') {
            throw new Error('mapDashboardErrorMessage was not exported on window');
        }
        if (typeof dash.consumeDashboardErrorParam !== 'function') {
            throw new Error('consumeDashboardErrorParam was not exported on window');
        }
    });

    describe('mapDashboardErrorMessage', () => {
        it('returns the agent-only message for unauthorized_role', () => {
            const msg = dash.mapDashboardErrorMessage('unauthorized_role');
            expect(msg).toBe('Agent dashboard is for users with agent role only');
        });

        it('returns null for empty / nullish codes', () => {
            expect(dash.mapDashboardErrorMessage('')).toBeNull();
            expect(dash.mapDashboardErrorMessage(null)).toBeNull();
            expect(dash.mapDashboardErrorMessage(undefined)).toBeNull();
        });

        it('falls back to a generic friendly message for unknown codes', () => {
            const msg = dash.mapDashboardErrorMessage('some_future_code');
            expect(msg).toBeTruthy();
            // Generic message MUST NOT echo the raw code (privacy / UX).
            expect(msg).not.toContain('some_future_code');
            // But it should communicate that something went wrong.
            expect(String(msg).toLowerCase()).toMatch(/sorry|unable|cannot|error|something/);
        });
    });

    describe('consumeDashboardErrorParam', () => {
        let calls: Array<[unknown, string, string]>;
        function makeWin(search: string) {
            calls = [];
            return {
                location: { search, pathname: '/dashboard', hash: '' },
                history: {
                    replaceState: (s: unknown, t: string, url: string) => {
                        calls.push([s, t, url]);
                    },
                },
            };
        }

        beforeEach(() => { calls = []; });

        it('returns null when no error param is present', () => {
            const win = makeWin('');
            expect(dash.consumeDashboardErrorParam(win)).toBeNull();
            // No URL rewrite when nothing to strip.
            expect(calls.length).toBe(0);
        });

        it('returns the friendly message AND strips the param from the URL', () => {
            const win = makeWin('?error=unauthorized_role');
            const msg = dash.consumeDashboardErrorParam(win);
            expect(msg).toBe('Agent dashboard is for users with agent role only');
            // history.replaceState invoked with the param removed.
            expect(calls.length).toBe(1);
            const [, , url] = calls[0]!;
            expect(url).toBe('/dashboard');
        });

        it('preserves OTHER query params while stripping ?error', () => {
            const win = makeWin('?bucket=today&error=unauthorized_role&q=foo');
            dash.consumeDashboardErrorParam(win);
            expect(calls.length).toBe(1);
            const [, , url] = calls[0]!;
            expect(url).toContain('bucket=today');
            expect(url).toContain('q=foo');
            expect(url).not.toContain('error=unauthorized_role');
        });

        it('preserves URL hash when stripping the error param', () => {
            const win = {
                location: { search: '?error=unauthorized_role', pathname: '/dashboard', hash: '#today' },
                history: {
                    replaceState: (s: unknown, t: string, url: string) => {
                        calls.push([s, t, url]);
                    },
                },
            };
            dash.consumeDashboardErrorParam(win);
            expect(calls.length).toBe(1);
            const [, , url] = calls[0]!;
            expect(url).toContain('#today');
        });

        it('returns null + still strips the param when code is unknown', () => {
            // Even if mapDashboardErrorMessage falls back to generic, the
            // helper should still strip the URL — unknown codes should still
            // surface the generic toast (returning the message) so we keep
            // returning truthy here. But the URL should be cleaned either way.
            const win = makeWin('?error=mystery');
            const msg = dash.consumeDashboardErrorParam(win);
            // Generic fallback message returned, not null.
            expect(msg).toBeTruthy();
            expect(calls.length).toBe(1);
        });
    });
});
