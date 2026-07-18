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
export const OBSERVER_COOKIE_NAME = '__Host-observer_session';
export const OBSERVER_EXPIRED_PATH = '/observer/expired';
