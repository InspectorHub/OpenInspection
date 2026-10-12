import type { Context } from 'hono';
import type { HumanVerifier } from './outbound-cooling-window';
import { isInProcessRequest, memoOnce } from '../request-scope';
import { resolveTurnstile, verifyTurnstileOutcome } from '../middleware/bot-protection';

/**
 * The request's Turnstile proof, if the web app attached one (`x-turnstile-token`,
 * relayed by the worker entry from the browser's one-time cookie).
 *
 * Verified lazily and at most once: only a send inside a new company's cooling
 * window ever asks, so most requests never pay for the siteverify call. Any
 * failure to verify reads as "not a person", never as a pass.
 */
export function buildHumanVerifier(c: Context): HumanVerifier | undefined {
    // Only the web app's own server-side relay may present a token. An API or MCP
    // client has no page to run the challenge on and is refused as before, and a
    // header it sets itself is ignored rather than trusted.
    if (!isInProcessRequest(c.env)) return undefined;
    const token = c.req.header('x-turnstile-token')?.trim();
    if (!token) return undefined;
    // Keyed by the token on the OUTER request's scope: a token redeems once, so every
    // in-process call of one page action must share a single answer, or the second
    // send of the same action would be refused for a token the first one spent.
    const attempt = async (): Promise<'yes' | 'no' | 'error'> => {
        const policy = resolveTurnstile(c.env);
        if (!policy.enforced) return 'no';
        try { return await verifyTurnstileOutcome(token, policy.secret); } catch { return 'error'; }
    };
    // One answer per token per page action, shared by every in-process call and by
    // concurrent callers. A could-not-tell answer gets one fresh attempt INSIDE the
    // shared computation, so the outcome that is kept is the second one; only if that
    // also fails is the person treated as unverified.
    const verifier: HumanVerifier = async () => {
        const outcome = await memoOnce(c.env, `human-verified:${token}`, async () => {
            const first = await attempt();
            return first === 'error' ? attempt() : first;
        });
        return outcome === 'yes';
    };
    // Also exposed on the context, so a route that learns the person is verified
    // (publish) can vouch for work it queued.
    c.set('humanVerified', verifier);
    return verifier;
}
