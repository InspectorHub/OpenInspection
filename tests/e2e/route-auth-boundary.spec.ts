/**
 * The auth boundary between the protected branch and the public one.
 *
 * Protection here is structural rather than per-route: `auth-layout.tsx`'s
 * loader calls `requireToken`, and a parent loader runs before its children, so
 * every route nested under that layout in `app/routes.ts` is guarded by
 * membership of the branch. Routes outside it — public booking, report viewing,
 * signing — must stay reachable with no session at all.
 *
 * That makes the branch boundary the load-bearing fact, and nothing in the unit
 * suites can see it: they call loaders directly, so a route moved out of the
 * layout keeps passing its own spec while silently losing its guard. The portal
 * side lost exactly that way — pages were moved to SSR and the guard did not
 * follow, and no unit test noticed for months.
 *
 * Asserted on HTTP STATUS, not on where a browser ends up: a page that renders
 * to an anonymous visitor and then redirects from its own JS is
 * indistinguishable from a server guard once the browser has settled.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';

/** Routes inside the auth layout — each must bounce an anonymous visitor. */
const PROTECTED = [
  '/inspections',
  '/calendar',
  '/contacts',
  '/settings',
  '/invoices',
  '/team',
  '/reports',
];

/**
 * Routes deliberately outside it. A guard that creeps up to cover these would
 * break public booking and report delivery — the failure mode worth pinning,
 * because it is invisible until a customer hits it.
 */
const PUBLIC = [
  '/login',
  '/forgot-password',
];

test.describe('protected branch', () => {
  for (const path of PROTECTED) {
    test(`${path} redirects an anonymous visitor to login`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      expect(res.status(), `${path} should be guarded at the SSR layer`).toBe(302);
      expect(res.headers()['location']).toMatch(/\/login/);
    });
  }
});

test.describe('public branch', () => {
  for (const path of PUBLIC) {
    test(`${path} stays reachable without a session`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      expect(res.status(), `${path} must not be swept into the guard`).toBe(200);
    });
  }
});
