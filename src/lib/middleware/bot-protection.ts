import { Context, Next } from 'hono';

/**
 * Verifies a Cloudflare Turnstile challenge token server-side.
 * Returns true if the token is valid.
 * Skips verification when TURNSTILE_SECRET_KEY is not configured (local dev).
 */
export async function verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
    if (!secretKey) throw new Error('TURNSTILE_SECRET_KEY is not configured');
    const body = new FormData();
    body.append('secret', secretKey);
    body.append('response', token);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
    });
    if (!res.ok) return false;
    const data = await res.json() as { success: boolean };
    return data.success;
}

/**
 * Middleware: reject requests from IPs flagged by Cloudflare's threat intelligence.
 * threat_score is 0??00; scores ??50 indicate likely bot/malicious traffic.
 * Silently skipped in local dev where the cf object is absent.
 */
export const blockHighThreatScore = async (c: Context, next: Next) => {
    const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf;
    const score = typeof cf?.threat_score === 'number' ? cf.threat_score : 0;
    if (score >= 50) {
        return c.json({ error: 'Request blocked.' }, 403);
    }
    return next();
};
