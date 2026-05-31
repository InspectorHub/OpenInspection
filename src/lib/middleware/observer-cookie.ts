/**
 * Design System 0520 subsystem D phase 5 task 5.1 — observer cookie guard.
 *
 * Reads `__Host-observer_session`, verifies the HMAC payload via
 * `verifyObserverCookie`, and enforces that the inspection id the
 * observer is requesting matches the one in the signed payload. On any
 * failure (missing / bad signature / wrong inspection / expired) the
 * request is redirected to `/observer/expired` so the observer sees a
 * friendly recovery page rather than a 401.
 *
 * The middleware is intentionally minimal: it does NOT validate roles
 * because observer sessions have no role at all — they're tied to a
 * single inspection id, period. Anything beyond read-only viewing
 * happens through the normal JWT-authenticated routes.
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyObserverCookie } from '../observer-cookie';
import type { HonoConfig } from '../../types/hono';

export const OBSERVER_COOKIE_NAME = '__Host-observer_session';
export const OBSERVER_EXPIRED_PATH = '/observer/expired';

export const observerCookieGuard: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const cookie = getCookie(c, OBSERVER_COOKIE_NAME);
    if (!cookie) return c.redirect(OBSERVER_EXPIRED_PATH);

    const payload = await verifyObserverCookie(cookie, c.env.JWT_SECRET);
    if (!payload) return c.redirect(OBSERVER_EXPIRED_PATH);

    // The viewer route uses :id; reject mismatched cookies so a stale
    // observer link from one inspection cannot be used to peek at another.
    const requestedId = c.req.param('id');
    if (requestedId && requestedId !== payload.inspectionId) {
        return c.text('Forbidden', 403);
    }

    // Stash for downstream handlers (e.g. ObservePage may want to show
    // the inspection id without re-fetching).
    c.set('observerPayload' as never, payload as never);
    await next();
    return;
};
