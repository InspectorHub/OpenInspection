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
