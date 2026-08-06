/**
 * What a client pays up front to hold the slot.
 *
 * Pure — no DB, no clock. A deposit is a SCHEDULING instrument: it exists so a
 * no-show costs the client something, not to finance the work. Nothing here
 * charges anything; it answers "how much", and the booking path snapshots the
 * answer.
 *
 * THREE TIERS, and the middle one sets a RATE, not a row.
 *
 *   1. the workspace default (`tenant_configs.deposit_policy`)
 *   2. the service's own policy (`services.deposit_policy`), NULL = inherit
 *   3. a human's number on one booking (`inspections.deposit_required_cents`
 *      with `deposit_overridden`), which nothing here computes — the whole
 *      point of tier 3 is that it is not computed.
 *
 * `none` is a VALUE, not an absence. A workspace that requires 20% still has
 * one add-on it never charges for, and `{ type: 'none' }` on that service is
 * how it says so. NULL means "inherit"; the two are different answers.
 *
 * ON THE UNIT CONTRACT. `{ type, value }` is the shape this was specified in
 * and it is not the shape it ships in: a bare `value` on a money field has no
 * unit, so `50` is half the price under one `type` and fifty cents under
 * another, and nothing in the type system objects. The fields name their own
 * units instead — the same correction `CancellationFee` (next door) and
 * `service_pay_rules` (validations/service.schema.ts) both already made.
 *
 * It is a plain object with a `type` enum rather than a discriminated union,
 * which is what the same lesson would otherwise suggest, and that is
 * deliberate: this type crosses `hono/client` on the services routes, and
 * `service.schema.ts` records a MEASURED type-check heap death from exactly
 * that (six union members through the RPC type took `type-check:app` past 8 GB
 * with no error to read). One object plus a cross-field refinement enforces the
 * identical contract at one plain object's type cost.
 */

export interface DepositPolicy {
    /**
     * `none` charges nothing — as an OVERRIDE it is how a service opts out of a
     * workspace default that would otherwise apply to it.
     */
    type: 'none' | 'percent' | 'fixed';
    /** Whole percent, 0-100. Meaningful only when `type` is 'percent'. */
    percent?: number | undefined;
    /** Integer cents. Meaningful only when `type` is 'fixed'. */
    amountCents?: number | undefined;
}

/** One selected service, with whatever policy it carries of its own. */
export interface DepositLine {
    priceCents: number;
    /** NULL = inherit the workspace default. */
    policy: DepositPolicy | null;
}

/**
 * One policy against one price. Never more than the price: a fixed $200 deposit
 * against a $150 add-on is a deposit of $150, not a $50 receivable nobody
 * agreed to. Rounded to whole cents, because that is the only unit money moves
 * in.
 */
function chargeAgainst(policy: DepositPolicy, priceCents: number): number {
    const price = Math.max(0, Math.round(priceCents));
    if (policy.type === 'none') return 0;
    const wanted = policy.type === 'fixed'
        ? Math.round(policy.amountCents ?? 0)
        : Math.round((price * (policy.percent ?? 0)) / 100);
    return Math.min(Math.max(0, wanted), price);
}

/**
 * The deposit for ONE line: the service's own policy when it has one, the
 * workspace default otherwise, nothing when neither exists.
 */
export function resolveDeposit(input: {
    tenant: DepositPolicy | null;
    service: DepositPolicy | null;
    priceCents: number;
}): number {
    const policy = input.service ?? input.tenant;
    if (!policy) return 0;
    return chargeAgainst(policy, input.priceCents);
}

/**
 * The deposit for a whole ORDER — one number, pinned to the primary inspection,
 * never mapped per service. A multi-service booking is one order with ancillary
 * services beneath it (the competitor model, and the reason the N-inspections
 * shape we chose internally must not leak into the money).
 *
 * The workspace default is applied ONCE, to the part of the order no service
 * has spoken for; services that carry their own policy are resolved
 * individually and added. Both halves are load-bearing:
 *
 *   - Applying the workspace default per line would turn a flat "$100 deposit"
 *     into $300 on a three-service booking. It is one number for the order.
 *   - Applying it to the WHOLE order would silently re-charge the lines that
 *     opted out with `{ type: 'none' }`, which is the one thing tier 2 exists
 *     to allow.
 *
 * When every policy in play is a percentage the two readings agree, which is
 * the common case; they diverge exactly where the tenant has configured a
 * difference, and then this is the reading that honours it.
 */
export function resolveOrderDeposit(input: {
    tenant: DepositPolicy | null;
    lines: DepositLine[];
}): number {
    const { tenant, lines } = input;
    let owed = 0;
    let unspokenForCents = 0;
    let totalCents = 0;
    for (const line of lines) {
        const price = Math.max(0, Math.round(line.priceCents));
        totalCents += price;
        if (line.policy) owed += resolveDeposit({ tenant: null, service: line.policy, priceCents: price });
        else unspokenForCents += price;
    }
    if (unspokenForCents > 0) {
        owed += resolveDeposit({ tenant, service: null, priceCents: unspokenForCents });
    }
    return Math.min(owed, totalCents);
}
