import { loadTenantSecrets } from '../secrets-cache';
import { tenantConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

export interface TwilioCreds { sid: string; token: string; from: string; }
type CredBag = Partial<Record<'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM_NUMBER', string | undefined>>;

/**
 * Pure resolution mirroring assembleTenantEmailService's own-vs-platform logic.
 * `own` takes effect ONLY when mode==='own' AND all three tenant keys are present;
 * otherwise platform env wins, with tenant creds as a last-resort fallback (so a
 * standalone operator who set keys via the Settings UI without flipping mode still
 * sends). Returns null when no complete credential set is resolvable (fail-closed).
 */
export function resolveTwilio(
    mode: 'platform' | 'own',
    tenant: CredBag,
    platform: CredBag,
): TwilioCreds | null {
    const complete = (b: CredBag): TwilioCreds | null =>
        b.TWILIO_ACCOUNT_SID && b.TWILIO_AUTH_TOKEN && b.TWILIO_FROM_NUMBER
            ? { sid: b.TWILIO_ACCOUNT_SID, token: b.TWILIO_AUTH_TOKEN, from: b.TWILIO_FROM_NUMBER }
            : null;
    const own = complete(tenant);
    if (mode === 'own' && own) return own;
    return complete(platform) ?? own;
}

/**
 * Track L (D) — which credential set `resolveTwilio` would pick, as a label, for
 * the Settings "effective source" line. Mirrors resolveTwilio's decision exactly
 * (own wins only with mode==='own' + complete tenant creds; else platform; else
 * tenant fallback; else none) WITHOUT exposing any secret value.
 */
export function resolveTwilioSource(
    mode: 'platform' | 'own',
    tenant: CredBag,
    platform: CredBag,
): 'own' | 'platform' | 'none' {
    const isComplete = (b: CredBag) =>
        Boolean(b.TWILIO_ACCOUNT_SID && b.TWILIO_AUTH_TOKEN && b.TWILIO_FROM_NUMBER);
    const ownComplete = isComplete(tenant);
    if (mode === 'own' && ownComplete) return 'own';
    if (isComplete(platform)) return 'platform';
    return ownComplete ? 'own' : 'none';
}

export interface TwilioLoaderEnv {
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
}

/**
 * Async loader for non-request contexts (cron flush): reads the tenant's sms_mode
 * + decrypted TWILIO_* secrets, applies resolveTwilio against the platform env.
 */
export async function loadTwilioForTenant(env: TwilioLoaderEnv, tenantId: string): Promise<TwilioCreds | null> {
    const db = drizzle(env.DB);
    const cfg = await db.select({ smsMode: tenantConfigs.smsMode }).from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId)).get().catch(() => null);
    const mode = (cfg?.smsMode as 'platform' | 'own') ?? 'platform';
    const dec = (await loadTenantSecrets(
        env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
    ).catch(() => null)) ?? {};
    return resolveTwilio(
        mode,
        {
            TWILIO_ACCOUNT_SID: dec['TWILIO_ACCOUNT_SID'],
            TWILIO_AUTH_TOKEN: dec['TWILIO_AUTH_TOKEN'],
            TWILIO_FROM_NUMBER: dec['TWILIO_FROM_NUMBER'],
        },
        {
            TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
            TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
            TWILIO_FROM_NUMBER: env.TWILIO_FROM_NUMBER,
        },
    );
}
