/**
 * Who sent an SMS, and on whose behalf. Two questions, two answers.
 *
 * review review: the owner of the number is not automatically the legal
 * sender. In the default mode a message leaves the PLATFORM's shared number
 * carrying the TENANT's brand — so "who initiated this transmission" and "on
 * whose behalf was it sent" are genuinely different, and neither should have to
 * be reconstructed later by inferring it from `sms_mode`. A record that has to
 * be inferred is a record that will be inferred wrongly.
 *
 * ── Why the platform is always the sender, even on a BYO key ─────────────────
 * The tempting simplification is that in `own` mode the tenant is the sender.
 * They are not. We chose the provider, we wrote the template, we operate the
 * consent gate, and we decide what may go out; a bring-your-own key changes
 * whose account is billed, not who built the path. Collapsing the two roles is
 * the exact move review identified — and the spec asserts against it in both
 * BYO-shaped modes rather than trusting the comment.
 *
 * ── Why the name is not `resolveSenderIdentity` ──────────────────────────────
 * `server/lib/email/sender-identity.ts` already exports that name, with a
 * different signature and a different return type, and it is imported by
 * `server/services/email/base.ts` and named in a schema column comment. Two
 * exports of one name in sibling domain folders are distinguishable only by
 * their import path — the one thing a reader does not see at the call site in a
 * diff. So this side carries the `Sms` prefix on the function and the type. The
 * FILE keeps the plain name: the directory already says which domain it is, and
 * `sms/sms-sender-identity.ts` stutters.
 *
 * The email side is deliberately untouched. It is shipped, it has its own spec,
 * and renaming a live export to make room for a new one bills the cost to the
 * wrong side of the change.
 */
import type { AutomationChannel } from '../../services/automation/shared';

/**
 * The platform's name as the initiating sender.
 *
 * A constant rather than `APP_NAME`, and that is the point: this field records
 * WHO OPERATED THE TRANSMISSION, which is this software's operator regardless of
 * what a deployment renamed itself to in branding. A self-hoster who sets
 * APP_NAME to their own company is still the party that initiated the send, and
 * the honest reading of that is captured by the deployment identity — not by a
 * display string a tenant can edit.
 */
export const PLATFORM_SENDER = 'InspectorHub' as const;

/** The subset of tenant config this resolution needs. Narrow on purpose. */
export interface SmsSenderIdentityConfig {
    /** `tenant_configs.sms_mode`. */
    smsMode: 'platform' | 'own' | 'managed_shared' | 'managed_dedicated';
    /** `tenant_configs.company_name`. Null, empty and whitespace all mean absent. */
    companyName?: string | null | undefined;
}

export interface SmsSenderIdentity {
    /** Who operated the transmission. Always the platform — see the header. */
    platformSender: typeof PLATFORM_SENDER;
    /** The tenant id the message was sent for. */
    tenantOnWhoseBehalf: string;
    /**
     * The brand the RECIPIENT sees, or null.
     *
     * Null rather than a fallback. A brand is a name a company chose; falling
     * back to the platform name or to a slug would put a name on a message its
     * recipient has never seen that company use — the same defect class as
     * deriving a person's name from their email address, which this repository
     * has a gate against.
     */
    tenantBrand: string | null;
    /** Recorded as observed, so the mode at send time survives a later change. */
    smsMode: SmsSenderIdentityConfig['smsMode'];
    /** Always 'sms' here; present so a shared log row can say which channel. */
    channel: AutomationChannel;
}

export function resolveSmsSenderIdentity(
    cfg: SmsSenderIdentityConfig,
    tenantId: string,
): SmsSenderIdentity {
    const brand = (cfg.companyName ?? '').trim();
    return {
        platformSender: PLATFORM_SENDER,
        tenantOnWhoseBehalf: tenantId,
        tenantBrand: brand === '' ? null : brand,
        smsMode: cfg.smsMode,
        channel: 'sms',
    };
}
