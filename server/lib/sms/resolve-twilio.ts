import { loadTenantSecrets } from '../secrets-cache';
import { tenantConfigs, messagingCompliance } from '../db/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { TwilioCreds } from '../messaging/twilio';
import type { MessagingProvider } from '../messaging/provider';

export type { TwilioCreds } from '../messaging/twilio';

type CredBag = Partial<Record<'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM_NUMBER', string | undefined>>;

/**
 * Complete managed-pool credential bag. Must be built by the async loader from
 * platform env (API key triple) + either the shared Messaging Service SID (env)
 * or the tenant's dedicated one (messagingCompliance.messagingResourceSid).
 * All four fields must be truthy for the managed branch to fire; any missing field
 * falls through to own/platform creds (fail-closed: standalone with no API key env
 * never builds a managed bag and is therefore unaffected).
 */
export interface ManagedBag {
    sid: string;                 // master Account SID (TWILIO_ACCOUNT_SID)
    token: string;               // API Key Secret (TWILIO_API_KEY_SECRET)
    authSid: string;             // API Key SID (TWILIO_API_KEY_SID)
    messagingServiceSid: string; // Messaging Service SID (shared or tenant-dedicated)
    from?: string;               // optional From number (usually absent for managed)
}

/**
 * Pure resolution mirroring assembleTenantEmailService's own-vs-platform logic.
 * `own` takes effect ONLY when mode==='own' AND all three tenant keys are present;
 * otherwise platform env wins, with tenant creds as a last-resort fallback (so a
 * standalone operator who set keys via the Settings UI without flipping mode still
 * sends). Returns null when no complete credential set is resolvable (fail-closed).
 *
 * Managed branch (managed_shared / managed_dedicated): when the optional `managed`
 * bag is supplied AND all four required fields are present, returns TwilioCreds
 * carrying authSid + messagingServiceSid for the API-key send path. When the bag
 * is absent or incomplete (any required field falsy), falls through to own/platform
 * creds — fail-closed in standalone where no API-key env is set.
 */
export function resolveTwilio(
    mode: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated',
    tenant: CredBag,
    platform: CredBag,
    managed?: ManagedBag,
): TwilioCreds | null {
    // Managed branch — fires first for managed modes when a complete bag is available.
    if ((mode === 'managed_shared' || mode === 'managed_dedicated') && managed) {
        const { sid, token, authSid, messagingServiceSid, from } = managed;
        if (sid && token && authSid && messagingServiceSid) {
            return { sid, token, from: from ?? '', authSid, messagingServiceSid };
        }
    }
    // Own/platform fall-through (unchanged from original behavior).
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
    /** API Key SID for the managed-pool send path (not the Account SID). */
    TWILIO_API_KEY_SID?: string;
    /** API Key Secret for the managed-pool send path. */
    TWILIO_API_KEY_SECRET?: string;
    /** Shared Messaging Service SID used by all managed_shared tenants. */
    TWILIO_SHARED_MESSAGING_SERVICE_SID?: string;
}

/**
 * Build a managed-pool credential bag for managed_shared or managed_dedicated
 * modes. Returns undefined when any required platform env field is missing (so
 * callers fall through to own/platform creds — fail-closed in standalone).
 *
 * managed_shared: messagingServiceSid comes from TWILIO_SHARED_MESSAGING_SERVICE_SID.
 * managed_dedicated: messagingServiceSid comes from the tenant's messagingCompliance row.
 * If the row is absent or the SID is unset the bag is incomplete → undefined → fall-through.
 */
async function buildManagedBag(
    env: TwilioLoaderEnv,
    mode: 'managed_shared' | 'managed_dedicated',
    tenantId: string,
): Promise<ManagedBag | undefined> {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const apiKeySid  = env.TWILIO_API_KEY_SID;
    const apiSecret  = env.TWILIO_API_KEY_SECRET;
    if (!accountSid || !apiKeySid || !apiSecret) return undefined;

    let messagingServiceSid: string | undefined;
    if (mode === 'managed_shared') {
        messagingServiceSid = env.TWILIO_SHARED_MESSAGING_SERVICE_SID;
    } else {
        // managed_dedicated: read the tenant's provisioned Messaging Service SID.
        const db = drizzle(env.DB);
        const row = await db
            .select({ messagingServiceSid: messagingCompliance.messagingResourceSid })
            .from(messagingCompliance)
            .where(eq(messagingCompliance.tenantId, tenantId))
            .get()
            .catch(() => null);
        messagingServiceSid = row?.messagingServiceSid ?? undefined;
    }
    if (!messagingServiceSid) return undefined;
    return { sid: accountSid, token: apiSecret, authSid: apiKeySid, messagingServiceSid };
}

/**
 * Async loader for non-request contexts (cron flush): reads the tenant's sms_mode
 * + decrypted TWILIO_* secrets, applies resolveTwilio against the platform env.
 * This function is Twilio-only and its behavior is byte-for-byte unchanged for
 * own/platform modes. For managed modes it builds the managed bag from env and
 * (for dedicated) the tenant's messagingCompliance row.
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

    const managed = (mode === 'managed_shared' || mode === 'managed_dedicated')
        ? await buildManagedBag(env, mode, tenantId)
        : undefined;

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
        managed,
    );
}

export interface ResolvedProvider {
    provider: MessagingProvider;
    /** The from-number to pass to sendMessage. Null for Telnyx (provider uses its own creds internally). */
    from: string | null;
    /**
     * Twilio Messaging Service SID for managed sends (managed_shared / managed_dedicated).
     * When set, the provider uses it instead of `from` — the Messaging Service selects the
     * sending number from its pool. Absent (undefined) for own/platform/Telnyx sends.
     */
    messagingServiceSid?: string | null;
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

    // Twilio path (null, undefined, or 'twilio') — delegates to resolveTwilio.
    const managed = (mode === 'managed_shared' || mode === 'managed_dedicated')
        ? await buildManagedBag(env, mode, tenantId)
        : undefined;

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
        managed,
    );
    if (!creds) return null;
    const { resolveProvider } = await import('../messaging/resolve-provider');
    return {
        provider: resolveProvider('twilio', creds),
        from: creds.from || null,
        messagingServiceSid: creds.messagingServiceSid ?? null,
    };
}
