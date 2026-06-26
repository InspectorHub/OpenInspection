import { loadTenantSecrets } from '../secrets-cache';
import { tenantConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { TwilioCreds } from '../messaging/twilio';
import type { MessagingProvider } from '../messaging/provider';

export type { TwilioCreds } from '../messaging/twilio';

type CredBag = Partial<Record<'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM_NUMBER', string | undefined>>;

/**
 * Pure resolution mirroring assembleTenantEmailService's own-vs-platform logic.
 * `own` takes effect ONLY when mode==='own' AND all three tenant keys are present;
 * otherwise platform env wins, with tenant creds as a last-resort fallback (so a
 * standalone operator who set keys via the Settings UI without flipping mode still
 * sends). Returns null when no complete credential set is resolvable (fail-closed).
 * `managed_shared` / `managed_dedicated` fall through to platform creds here until
 * the managed-pool builder is wired (later plan tasks).
 */
export function resolveTwilio(
    mode: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated',
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
 * Return type is the *effective credential source* (own/platform/none) — a different
 * concept from the tenant's selected mode; do not conflate the two.
 */
export function resolveTwilioSource(
    mode: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated',
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
 * This function is Twilio-only and its behavior is byte-for-byte unchanged.
 * Use loadProviderForTenant for provider-aware dispatch (BYO Twilio or Telnyx).
 */
export async function loadTwilioForTenant(env: TwilioLoaderEnv, tenantId: string): Promise<TwilioCreds | null> {
    const db = drizzle(env.DB);
    const cfg = await db.select({ smsMode: tenantConfigs.smsMode }).from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId)).get().catch(() => null);
    const mode = cfg?.smsMode ?? 'platform';
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

export interface ResolvedProvider {
    provider: MessagingProvider;
    /** The from-number to pass to sendMessage. Null for Telnyx (provider uses its own creds internally). */
    from: string | null;
}

/**
 * Provider-aware loader: reads `sms_byo_provider` from the tenant config to select
 * between Twilio (default) and Telnyx. Returns a ResolvedProvider or null when
 * no complete credential set is available (fail-closed).
 *
 * Twilio path (null | 'twilio'): delegates to resolveTwilio — same logic as
 * loadTwilioForTenant, ensuring existing Twilio behavior is UNCHANGED.
 * Telnyx path ('telnyx'): reads TELNYX_API_KEY + TELNYX_FROM_NUMBER from the
 * tenant's encrypted secrets envelope; from is null (TelnyxProvider reads it).
 */
export async function loadProviderForTenant(env: TwilioLoaderEnv, tenantId: string): Promise<ResolvedProvider | null> {
    const db = drizzle(env.DB);
    const cfg = await db
        .select({ smsMode: tenantConfigs.smsMode, smsByoProvider: tenantConfigs.smsByoProvider })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get()
        .catch(() => null);
    const mode = cfg?.smsMode ?? 'platform';
    const byoProvider = cfg?.smsByoProvider ?? null;

    const dec = (await loadTenantSecrets(
        env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
    ).catch(() => null)) ?? {};

    if (byoProvider === 'telnyx') {
        // Telnyx BYO path — only available in own mode with complete keys.
        if (mode !== 'own') return null;
        const apiKey = dec['TELNYX_API_KEY'];
        const from = dec['TELNYX_FROM_NUMBER'];
        if (!apiKey || !from) return null;
        const { resolveProvider } = await import('../messaging/resolve-provider');
        return { provider: resolveProvider('telnyx', { apiKey, from }), from: null };
    }

    // Twilio path (null, undefined, or 'twilio') — delegates to existing resolveTwilio.
    const creds = resolveTwilio(
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
    if (!creds) return null;
    const { resolveProvider } = await import('../messaging/resolve-provider');
    return { provider: resolveProvider('twilio', creds), from: creds.from };
}
