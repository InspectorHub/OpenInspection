/**
 * Whether a company's own Stripe account has every key a card payment needs.
 *
 * ONE definition, read by two surfaces that must never disagree: the settings
 * overview card (`connected` / `attention`) and the public booking profile
 * (`paymentsAvailable`, which decides whether a client is offered a Pay button).
 *
 * Presence only. No key value is returned from anything in this module.
 */
import { loadTenantSecrets } from '../secrets-cache';
import { memoOnce } from '../request-scope';
import type { DeploymentProfile } from '../deployment-profile';

export const STRIPE_KEYS = ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

const present = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** The three Stripe keys as they may sit in the deployment's environment. */
export interface StripeEnvKeys {
    STRIPE_PUBLISHABLE_KEY?: string | undefined;
    STRIPE_SECRET_KEY?: string | undefined;
    STRIPE_WEBHOOK_SECRET?: string | undefined;
}

/**
 * How many of the three keys the company holds. Card payments always go to the company's own account: on a hosted
 * deployment a key in the deployment's environment is never read for it. Where the environment IS the company's own
 * (a self-hosted install), all three keys count from either place, which is also what the routes read after the
 * secrets middleware has merged the stored values over the environment.
 */
export function countStripeKeys(
    ownSecrets: Record<string, string | undefined> | undefined,
    profile: Pick<DeploymentProfile, 'envCredentialsAreCompanyOwn'> | undefined,
    env: StripeEnvKeys,
): number {
    return STRIPE_KEYS.filter((k) => present(ownSecrets?.[k])
        || (profile?.envCredentialsAreCompanyOwn && present(env[k]))).length;
}

interface StripeKeysEnv extends StripeEnvKeys {
    DB: D1Database;
    TENANT_CACHE?: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
}

/**
 * For a request that did not establish its tenant through the secrets
 * middleware (the public booking profile resolves its company from the slug in
 * the handler, so its `c.env` carries no company keys). Reads the stored blob
 * through the same memoised loader the middleware uses; fails soft to `false`.
 */
export async function companyStripeKeysComplete(args: {
    env: StripeKeysEnv;
    profile: DeploymentProfile;
    tenantId: string;
}): Promise<boolean> {
    const { env, profile, tenantId } = args;
    const secrets = await memoOnce(env, `secrets:${tenantId}`, () => loadTenantSecrets(
        env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
    )).catch(() => null);
    return countStripeKeys(secrets ?? undefined, profile, env) === STRIPE_KEYS.length;
}
