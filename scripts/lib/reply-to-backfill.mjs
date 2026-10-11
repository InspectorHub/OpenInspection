/**
 * Which tenants get a Reply-To filled in, and with what.
 *
 * Pure: rows in, plan out, no database. `scripts/backfill-reply-to.mjs` reads
 * the rows and writes the plan; this module only decides, so the rules can be
 * tested without either.
 *
 * Rules:
 *   - a `reply_to` that is NULL, empty or whitespace-only counts as unset;
 *     anything else is a choice the operator made and is never touched;
 *   - the owner is the EARLIEST-created user with the `owner` role. If that
 *     person's email is blank the tenant is skipped, not handed to the next
 *     owner: guessing a different address is worse than leaving the field empty;
 *   - a tenant with no owner is skipped.
 */

/** @param {unknown} v */
const blank = (v) => typeof v !== 'string' || v.trim() === '';

/**
 * @param {{ tenantId: string, replyTo: string | null }[]} tenants
 * @param {{ tenantId: string, email: string | null, createdAt: number }[]} owners
 * @returns {{ fills: { tenantId: string, email: string }[], skipped: { tenantId: string, reason: string }[] }}
 */
export function planReplyToBackfill(tenants, owners) {
    /** @type {Map<string, { email: string | null, createdAt: number }>} */
    const earliest = new Map();
    for (const o of owners) {
        const cur = earliest.get(o.tenantId);
        if (!cur || o.createdAt < cur.createdAt) earliest.set(o.tenantId, o);
    }

    const fills = [];
    const skipped = [];
    for (const t of tenants) {
        if (!blank(t.replyTo)) {
            skipped.push({ tenantId: t.tenantId, reason: 'already-set' });
            continue;
        }
        const owner = earliest.get(t.tenantId);
        if (!owner) {
            skipped.push({ tenantId: t.tenantId, reason: 'no-owner' });
        } else if (blank(owner.email)) {
            skipped.push({ tenantId: t.tenantId, reason: 'owner-email-blank' });
        } else {
            fills.push({ tenantId: t.tenantId, email: owner.email.trim() });
        }
    }
    return { fills, skipped };
}
