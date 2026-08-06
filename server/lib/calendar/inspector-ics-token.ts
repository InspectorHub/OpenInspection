/**
 * Per-inspector subscription token for the schedule feed.
 *
 * The busy feed is addressed by `users.slug` and carries no PII, which is why a
 * guessable URL is tolerable there. The SCHEDULE feed carries property
 * addresses, and `/inspector/` is unauthenticated — a slug is a name, not a
 * secret, so anyone who can guess "mike" would get an inspector's daily route.
 *
 * Same construction as the SMS opt-in link (`lib/sms/optin-token.ts`) and the
 * same reason: no new table. The token is `<tenantId>~<sealed userId>`, sealed
 * under the tenant's AAD, so tampering with either half fails to open. It is
 * deterministic, so the settings page can display it without a write.
 *
 * TRADE-OFF, stated deliberately: because it is derived rather than stored,
 * revoking one inspector's link means rotating JWT_SECRET, which revokes every
 * link. `tenant_configs.ics_token` can be rotated per tenant because it is a
 * stored random value. If per-inspector revocation is ever needed, this becomes
 * a `users` column and this module keeps its shape.
 */
import { sealToken, openToken } from '../config-crypto';

const DELIM = '~';

export async function mintInspectorIcsToken(
    tenantId: string, userId: string, jwtSecret: string,
): Promise<string> {
    const sealed = await sealToken(userId, tenantId, jwtSecret);
    return `${tenantId}${DELIM}${sealed}`;
}

/** Returns { tenantId, userId } or null on any format / AAD / key mismatch. */
export async function resolveInspectorIcsToken(
    token: string, jwtSecret: string, jwtSecretPrevious?: string,
): Promise<{ tenantId: string; userId: string } | null> {
    const idx = token.indexOf(DELIM);
    if (idx <= 0) return null;
    const tenantId = token.slice(0, idx);
    const sealed = token.slice(idx + 1);
    if (!tenantId || !sealed) return null;
    try {
        const userId = await openToken(sealed, tenantId, jwtSecret, jwtSecretPrevious);
        return userId ? { tenantId, userId } : null;
    } catch {
        return null;
    }
}
