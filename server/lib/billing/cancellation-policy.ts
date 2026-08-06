/**
 * The shape of a tenant's cancellation ladder.
 *
 * Type only — the arithmetic lives in `./cancellation-outcome.ts` and the wire
 * validation in `server/lib/validations/admin/settings.ts`. It is separate from
 * both because `tenant_configs.cancellationPolicy` needs the type at the schema
 * definition, and a schema file must not pull in Zod or a resolver.
 *
 * A fee is a DISCRIMINATED UNION rather than `{ type, value }`: a bare `value`
 * on a real-money field has no unit, so "50" reads as either half the price or
 * fifty cents depending on the sibling field, and nothing in the type system
 * objects. Splitting it also makes "percent above 100" a range on a field that
 * only exists in the percent arm, instead of a rule that has to remember which
 * variant it is looking at.
 */

export type CancellationFee =
    | { type: 'percent'; percent: number }
    | { type: 'fixed'; amountCents: number };

export interface CancellationPolicy {
    /**
     * Notice threshold in HOURS. Hours only in v1: "2 business days" — the other
     * phrasing every published policy uses — needs the tenant timezone, a
     * weekend rule and a holiday list, and only the first two exist here. An
     * hours threshold between two instants is exact and needs none of them.
     */
    noticeHours: number;
    /** Charged when the client cancels INSIDE the notice window. */
    lateFee: CancellationFee;
    /** Charged when the client does not show. Commonly 100%. */
    noShowFee: CancellationFee;
    /** `'credit'` (toward a future inspection) is deferred — see spec §4. */
    remedy: 'refund';
}

/** A zero fee on both rungs is a policy that never charges — no attestation needed. */
export function policyChargesFees(policy: CancellationPolicy | null | undefined): boolean {
    if (!policy) return false;
    return feeIsChargeable(policy.lateFee) || feeIsChargeable(policy.noShowFee);
}

function feeIsChargeable(fee: CancellationFee): boolean {
    return fee.type === 'percent' ? fee.percent > 0 : fee.amountCents > 0;
}
