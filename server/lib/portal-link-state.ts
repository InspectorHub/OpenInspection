/**
 * What a report link's row says about itself (IA-36 ③⑨⑪).
 *
 * A leaf module on purpose: the access guard, the token service and the People
 * card all have to agree on this, and `public-access.ts` sits in an import cycle
 * with the DI container's service types. One rule, no cycle.
 *
 * `revoked` deliberately outranks `expired`. A revoked link must stay dead no
 * matter how generous the expiry policy later becomes — otherwise "revoke" is
 * only "set the expiry to the past" wearing a stronger name, and nobody has a
 * reason to trust it.
 */
export type PortalLinkState = 'active' | 'expired' | 'revoked' | 'unknown';

/** `unknown` = there is no row to speak for (never issued, or already gone). */
export function portalLinkState(
    row: { revokedAt: number | null; expiresAt: number | null } | null | undefined,
    now: number = Date.now(),
): PortalLinkState {
    if (!row) return 'unknown';
    if (row.revokedAt != null) return 'revoked';
    if (row.expiresAt != null && row.expiresAt <= now) return 'expired';
    return 'active';
}
