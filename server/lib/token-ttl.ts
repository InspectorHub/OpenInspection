/**
 * IA-37 — default lifetimes + the fail-closed liveness predicate for the two
 * content-bearing public tokens (signer tokens on `agreement_signers`, share
 * tokens on `repair_requests`). Kept in one place so issuance and enforcement
 * can't drift, and so the "NULL expiresAt = never expires" rule is stated once.
 *
 * These are the ISSUANCE defaults. A tenant-configurable override
 * (`reportLinkTtl`) is the lifecycle work tracked under IA-36; until it lands
 * these constants are the only source.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Signer (agreement) links: 90 days. */
export const SIGNER_TOKEN_TTL_MS = 90 * DAY_MS;

/** Repair-request share links: 180 days (contractors pass these around longer). */
export const SHARE_TOKEN_TTL_MS = 180 * DAY_MS;

/**
 * True when a token row must be treated as dead: explicitly revoked, or past its
 * expiry. A NULL `expiresAt` never expires (legacy / synthesized / backfilled
 * rows that predate issuance TTLs). Revocation always wins over expiry.
 */
export function isTokenRevokedOrExpired(
    row: { expiresAt?: Date | number | null; revokedAt?: Date | number | null },
    nowMs: number,
): boolean {
    if (row.revokedAt != null) return true;
    if (row.expiresAt != null) {
        const exp = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt);
        return exp <= nowMs;
    }
    return false;
}
