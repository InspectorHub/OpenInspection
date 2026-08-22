import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { M2M_HEADER, verifyM2mHeader } from '../lib/m2m-auth';

/**
 * Gate for portal→core integration endpoints.
 *
 * Auth is the `x-portal-m2m` HMAC header (see lib/m2m-auth.ts), NOT the
 * non-existent `cf-worker` header — Cloudflare injects no identifying header on
 * direct Service-Binding `.fetch()` calls, so the old cf-worker check failed
 * closed (403) on every binding call in production.
 */
export async function requireServiceBinding(c: Context<HonoConfig>, next: () => Promise<void>) {
    const verified = await verifyM2mHeader(
        c.env as unknown as Record<string, string | undefined>,
        c.req.header(M2M_HEADER),
    );
    if (!verified.ok) {
        return c.json({ success: false, error: { message: 'Forbidden' } }, 403);
    }
    // Set only after the MAC held. There are exactly TWO writers of
    // `platformActor` — this one, and `jwtAuthMiddleware` reading a session claim
    // — and what they have in common is the point: both take the value from
    // something the shared keyring signed. Nothing may set it from a header, a
    // query parameter or a body field, because the whole worth of the audit
    // column it feeds is that claiming to be a platform employee costs the key.
    if (verified.actor) c.set('platformActor', verified.actor);
    return next();
}
