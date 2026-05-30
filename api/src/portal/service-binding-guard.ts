import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

export async function requireServiceBinding(c: Context<HonoConfig>, next: () => Promise<void>) {
    if (!c.req.header('cf-worker')) {
        return c.json({ success: false, error: { message: 'Forbidden' } }, 403);
    }
    return next();
}

export function isServiceBindingCall(c: Context<HonoConfig>): boolean {
    return !!c.req.header('cf-worker');
}
