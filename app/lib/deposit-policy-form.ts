/**
 * The form half of the booking deposit (#278 follow-on).
 *
 * The API already speaks this shape (`server/lib/validations/deposit-policy.schema.ts`);
 * nothing here validates on its behalf. What lives here is the part a settings
 * form owns and a route action cannot: turning a human's choice into the wire
 * value, and reading a stored one back out of a payload the typed client does
 * not describe.
 *
 * TWO DISTINCTIONS THIS FILE EXISTS TO KEEP.
 *
 * 1. `null` is not `{ type: 'none' }`. On a SERVICE, null inherits the company
 *    default and `{ type: 'none' }` opts out of it — the one thing tier 2 exists
 *    to allow. Collapsing them silently re-charges every service the company
 *    excused. On the COMPANY default there is no third answer, so its "No
 *    deposit" clears the column (null) rather than storing an opt-out of
 *    itself.
 *
 * 2. The units are NOT the pay-rule units. `PayRuleWidget` sends BASIS POINTS
 *    and multiplies by 100 on the way out; a deposit percent is a WHOLE PERCENT
 *    (`z.number().min(0).max(100)`), so 20 goes on the wire as 20. The only x100
 *    in this path is dollars -> cents, and it happens inside `MoneyInput`
 *    (`parseCurrencyToCents`), beside the "$" the person can see. Sending 2000
 *    where 20 was meant asks a client for twenty times the price, and the
 *    schema's `max(100)` is the only thing that would notice.
 */

import type { DepositPolicy } from "../../server/lib/billing/deposit-policy";

/**
 * What the control offers. `inherit` exists only on a service — the company
 * default has nothing to inherit from.
 */
export type DepositChoice = "inherit" | "none" | "percent" | "fixed";

/** Which segment/option a stored policy corresponds to. */
export function depositChoiceOf(policy: DepositPolicy | null | undefined): DepositChoice {
    if (!policy) return "inherit";
    if (policy.type === "percent") return "percent";
    if (policy.type === "fixed") return "fixed";
    return "none";
}

/**
 * Read a stored policy out of an untyped JSON payload.
 *
 * `GET /api/admin/branding` returns the whole config row but its response
 * schema does not declare `deposit_policy`, so the typed client cannot see a
 * column that is really there. Anything that is not a well-formed policy reads
 * as "no policy" rather than throwing: a settings page that 500s because one
 * column is malformed is worse than one that shows the deposit as off.
 */
export function parseDepositPolicy(raw: unknown): DepositPolicy | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (o.type === "none") return { type: "none" };
    if (o.type === "percent" && typeof o.percent === "number") {
        return { type: "percent", percent: o.percent };
    }
    if (o.type === "fixed" && typeof o.amountCents === "number") {
        return { type: "fixed", amountCents: o.amountCents };
    }
    return null;
}

/**
 * The choice plus its number -> the value the API stores, or which field is
 * wrong.
 *
 * A zero is REFUSED rather than sent. `{ type: 'percent', percent: 0 }` passes
 * the API (min is 0) and charges nothing, which is a deposit policy that reads
 * as configured and behaves as off — exactly the half-saved state the control
 * is supposed to make impossible. "No deposit" is how you say nothing.
 */
export function depositPolicyFromChoice(input: {
    choice: DepositChoice;
    /** Raw text from the percent box. */
    percentText: string;
    /** Already-integer cents from `MoneyInput`; null when the box is empty. */
    amountCents: number | null;
}): { ok: true; policy: DepositPolicy | null } | { ok: false; field: "percent" | "amount" } {
    if (input.choice === "inherit") return { ok: true, policy: null };
    if (input.choice === "none") return { ok: true, policy: { type: "none" } };

    if (input.choice === "percent") {
        const percent = Number(input.percentText.trim());
        if (!input.percentText.trim() || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
            return { ok: false, field: "percent" };
        }
        // No x100. See the units note at the top of this file.
        return { ok: true, policy: { type: "percent", percent } };
    }

    const cents = input.amountCents;
    if (cents === null || !Number.isFinite(cents) || cents <= 0) return { ok: false, field: "amount" };
    return { ok: true, policy: { type: "fixed", amountCents: Math.round(cents) } };
}
