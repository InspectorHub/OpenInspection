/**
 * The bot challenge on the two surfaces an anonymous visitor can submit to:
 * the public booking form and agent self-signup.
 *
 * The policy lives here, in one function, rather than as an `if` at each call
 * site. That is the whole point: a bypass expressed as a condition at the call
 * site is a bypass someone has to remember to keep correct in two places, and
 * the two places drift. `resolveTurnstile` answers "is a challenge required,
 * and with which secret" once, and both callers obey the answer.
 */
import { getDeploymentProfile, type ProfileEnv } from '../deployment-profile';

/**
 * Cloudflare's PUBLISHED test keys, which always pass.
 *
 * A deliberate, documented exception to the no-fallback-constants rule: these
 * are constants out of Cloudflare's own documentation, not secrets, and nothing
 * is protected by keeping them out of the source. What they buy is that a SaaS
 * deployment with no key configured still RENDERS the widget, still requires a
 * token and still verifies it server-side — so the code path is exercised, and
 * turning on real protection is a configuration change rather than a code
 * change. The alternative, skipping when unconfigured, is a branch that has to
 * be right forever and silently disables the whole mechanism when it is not.
 *
 * @see https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export interface TurnstilePolicy {
    /** When true the caller MUST demand a token and verify it. */
    enforced: boolean;
    /** The secret to verify against. Empty exactly when `enforced` is false. */
    secret: string;
    /** True when running on the always-pass test key — worth a log line, not a failure. */
    usingTestKey: boolean;
}

type TurnstileEnv = ProfileEnv & { TURNSTILE_SECRET_KEY?: string };

/**
 * Whether this deployment challenges anonymous submissions, and with what.
 *
 * - **saas** — always enforced. A configured secret is used; without one the
 *   published test key is, so the mechanism is never off, only permissive.
 * - **standalone** — enforced only when the operator configured a secret. They
 *   run their own deployment on their own domain; a single-company install
 *   behind a private URL has a legitimate reason not to challenge anyone.
 *
 * Reads the capability, never `APP_MODE` — see `deployment-profile.ts`.
 */
export function resolveTurnstile(env: TurnstileEnv): TurnstilePolicy {
    const configured = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
    if (configured) return { enforced: true, secret: configured, usingTestKey: false };

    if (getDeploymentProfile(env).botProtectionMandatory) {
        return { enforced: true, secret: TURNSTILE_TEST_SECRET_KEY, usingTestKey: true };
    }
    return { enforced: false, secret: '', usingTestKey: false };
}

/** The site key the browser needs, matched to whatever `resolveTurnstile` will verify against. */
export function resolveTurnstileSiteKey(
    env: TurnstileEnv & { TURNSTILE_SITE_KEY?: string },
): string | null {
    const configured = env.TURNSTILE_SITE_KEY?.trim() ?? '';
    if (configured) return configured;
    // Must track the secret side exactly. A page rendering no widget against a
    // server that demands a token is a booking form nobody can submit — the
    // failure mode of getting these two out of step.
    return resolveTurnstile(env).enforced ? TURNSTILE_TEST_SITE_KEY : null;
}

/**
 * Verifies a Turnstile token server-side. Returns true if Cloudflare accepts it.
 *
 * Throws on an empty secret rather than treating one as a pass: whether a
 * challenge applies at all is `resolveTurnstile`'s decision, and this function
 * reaching that state means the caller ignored it.
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
