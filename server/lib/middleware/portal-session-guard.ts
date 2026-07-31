import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyPortalSession } from '../portal-session';
import type { HonoConfig } from '../../types/hono';
import { PORTAL_SESSION_COOKIE_NAME } from '../auth-helpers';

/**
 * Reads + verifies the `__Host-portal_session` cookie. On success sets
 * `portalEmail` on the context; on missing/invalid returns 401.
 *
 * Tenant-agnostic by design — the cookie carries only a verified email, and
 * every data query behind it is tenant-scoped to the path's tenantId. Lives
 * here rather than inside one route module because the client portal now has
 * more than one session-gated router (the Hub reads and the Notices inbox);
 * two copies of an auth gate is exactly the shape that drifts.
 */
export async function portalSessionGuard(c: Context<HonoConfig>, next: () => Promise<void>) {
    const cookie = getCookie(c, PORTAL_SESSION_COOKIE_NAME);
    const verified = cookie ? await verifyPortalSession(c.env.JWT_SECRET, cookie) : null;
    if (!verified) {
        return c.json({ error: 'Not authenticated' }, 401);
    }
    c.set('portalEmail', verified.email);
    await next();
    return;
}
