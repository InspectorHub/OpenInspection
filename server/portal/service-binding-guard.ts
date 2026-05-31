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
    const ok = await verifyM2mHeader(
        c.env as unknown as Record<string, string | undefined>,
        c.req.header(M2M_HEADER),
    );
    if (!ok) {
        return c.json({ success: false, error: { message: 'Forbidden' } }, 403);
    }
    return next();
}

export async function isServiceBindingCall(c: Context<HonoConfig>): Promise<boolean> {
    return verifyM2mHeader(
        c.env as unknown as Record<string, string | undefined>,
        c.req.header(M2M_HEADER),
    );
}
