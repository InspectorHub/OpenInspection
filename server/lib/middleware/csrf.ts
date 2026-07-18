import { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HonoConfig } from '../../types/hono';
import { Errors } from '../errors';
import { timingSafeEqual } from '../password';

const CSRF_COOKIE = '__Host-csrf_token';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF check. Apply to state-changing endpoints that can be called from a
 * browser *without* a prior session — notably the login endpoint, which is otherwise a
 * pathway for login-CSRF / session fixation.
 */
export const requireCsrfToken: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const cookieToken = getCookie(c, CSRF_COOKIE);
    const headerToken = c.req.header(CSRF_HEADER);
    if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
        throw Errors.Forbidden('CSRF token missing or invalid');
    }
    return next();
};
