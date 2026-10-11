import type { Context } from 'hono';
import type { HumanVerifier } from './outbound-cooling-window';
import { resolveTurnstile, verifyTurnstile } from '../middleware/bot-protection';

/**
 * The request's Turnstile proof, if the web app attached one (`x-turnstile-token`,
 * relayed by the worker entry from the browser's one-time cookie).
 *
 * Verified lazily and at most once: only a send inside a new company's cooling
 * window ever asks, so most requests never pay for the siteverify call. Any
 * failure to verify reads as "not a person", never as a pass.
 */
export function buildHumanVerifier(c: Context): HumanVerifier | undefined {
    const token = c.req.header('x-turnstile-token')?.trim();
    if (!token) return undefined;
    let once: Promise<boolean> | undefined;
    const verifier: HumanVerifier = () => (once ??= (async () => {
        const policy = resolveTurnstile(c.env);
        if (!policy.enforced) return false;
        try { return await verifyTurnstile(token, policy.secret); } catch { return false; }
    })());
    // Also exposed on the context, so a route that learns the person is verified
    // (publish) can vouch for work it queued.
    c.set('humanVerified', verifier);
    return verifier;
}
