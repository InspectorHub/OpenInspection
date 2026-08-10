/**
 * The form half of the cancellation policy (#19 Task 4).
 *
 * Sibling of `deposit-policy-form.ts` and deliberately shaped like it: the API
 * already speaks the wire type, so nothing here validates on its behalf. What
 * lives here is what a settings form owns and a route action cannot — turning a
 * human's choices into the stored value, and reading a stored one back out of a
 * payload the typed client does not describe.
 *
 * THREE THINGS THIS FILE EXISTS TO KEEP STRAIGHT.
 *
 * 1. **Zero means something here, and it is the opposite of the deposit.**
 *    `deposit-policy-form.ts` REFUSES a zero, because a deposit of nothing reads
 *    as configured and behaves as off. A cancellation fee of zero is a real
 *    answer: it is how a company says "we do not charge for this". It also
 *    decides whether the tenant must attest to a matching agreement clause —
 *    `policyChargesFees()` is false for an all-zero policy, so the attestation
 *    gate does not fire. Refusing zero here would force every company that
 *    charges nothing to attest to a clause it does not need.
 *
 * 2. **The policy is TWO fees, not one, and they can differ in kind.** A common
 *    published policy is "50% inside 24 hours, 100% for a no-show" — one percent
 *    and one percent — but "fixed $75 late, 100% no-show" is just as common.
 *    Each rung carries its own `type`, so the mapping below runs per rung and a
 *    caller cannot accidentally apply one rung's unit to the other.
 *
 * 3. **Percent is a WHOLE percent, cents are cents.** Same rule as the deposit:
 *    50 goes on the wire as 50, and the only x100 in the path is dollars ->
 *    cents inside `MoneyInput`, beside the "$" the person can see. There is no
 *    basis-points conversion anywhere in this file.
 */

import type {
    CancellationFee,
    CancellationPolicy,
} from "../../server/lib/billing/cancellation-policy";

/** What each fee control offers. There is no `inherit` — this is company-level. */
export type FeeChoice = "none" | "percent" | "fixed";

/** Which option a stored fee corresponds to. A zero fee reads as "none". */
export function feeChoiceOf(fee: CancellationFee | null | undefined): FeeChoice {
    if (!fee) return "none";
    if (fee.type === "percent") return fee.percent > 0 ? "percent" : "none";
    return fee.amountCents > 0 ? "fixed" : "none";
}

/** The zero of each kind, so "none" has a wire value rather than a hole. */
const NO_FEE: CancellationFee = { type: "fixed", amountCents: 0 };

/**
 * Read a stored policy out of an untyped JSON payload.
 *
 * `GET /api/admin/branding` returns the whole config row, but
 * `BrandingResponseSchema` does not declare `cancellation_policy` — the column
 * is really there and the typed client cannot see it. Same situation as
 * `deposit_policy`, same answer: anything malformed reads as "no policy" rather
 * than throwing, because a settings page that 500s over one column is worse
 * than one that shows the policy as unset.
 */
export function parseCancellationPolicy(raw: unknown): CancellationPolicy | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const notice = o.noticeHours;
    if (typeof notice !== "number" || !Number.isFinite(notice)) return null;
    const late = parseFee(o.lateFee);
    const noShow = parseFee(o.noShowFee);
    if (!late || !noShow) return null;
    return { noticeHours: notice, lateFee: late, noShowFee: noShow, remedy: "refund" };
}

function parseFee(raw: unknown): CancellationFee | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (o.type === "percent" && typeof o.percent === "number") {
        return { type: "percent", percent: o.percent };
    }
    if (o.type === "fixed" && typeof o.amountCents === "number") {
        return { type: "fixed", amountCents: o.amountCents };
    }
    return null;
}

/** One rung's choice plus its number -> the stored fee, or which field is wrong. */
export function feeFromChoice(input: {
    choice: FeeChoice;
    /** Raw text from the percent box. */
    percentText: string;
    /** Already-integer cents from `MoneyInput`; null when the box is empty. */
    amountCents: number | null;
}): { ok: true; fee: CancellationFee } | { ok: false; field: "percent" | "amount" } {
    if (input.choice === "none") return { ok: true, fee: NO_FEE };

    if (input.choice === "percent") {
        const percent = Number(input.percentText.trim());
        if (
            !input.percentText.trim() ||
            !Number.isFinite(percent) ||
            percent <= 0 ||
            percent > 100
        ) {
            return { ok: false, field: "percent" };
        }
        return { ok: true, fee: { type: "percent", percent } };
    }

    const cents = input.amountCents;
    if (cents === null || !Number.isFinite(cents) || cents <= 0) {
        return { ok: false, field: "amount" };
    }
    return { ok: true, fee: { type: "fixed", amountCents: Math.round(cents) } };
}

/**
 * The whole form -> the stored policy, or the first rung that is wrong.
 *
 * `noticeHours` is refused at zero and below. Unlike a fee, a zero notice window
 * is not "we do not charge" — it is "every cancellation is late", which is a
 * policy nobody publishes and which would make the late fee unavoidable. If a
 * company genuinely wants that, it is a 100% late fee with a large window, and
 * that is the thing they should have to type.
 */
export function cancellationPolicyFromForm(input: {
    noticeHoursText: string;
    late: Parameters<typeof feeFromChoice>[0];
    noShow: Parameters<typeof feeFromChoice>[0];
}):
    | { ok: true; policy: CancellationPolicy }
    | { ok: false; rung: "notice" | "late" | "noShow"; field?: "percent" | "amount" } {
    const hours = Number(input.noticeHoursText.trim());
    if (!input.noticeHoursText.trim() || !Number.isFinite(hours) || hours <= 0) {
        return { ok: false, rung: "notice" };
    }

    const late = feeFromChoice(input.late);
    if (!late.ok) return { ok: false, rung: "late", field: late.field };

    const noShow = feeFromChoice(input.noShow);
    if (!noShow.ok) return { ok: false, rung: "noShow", field: noShow.field };

    return {
        ok: true,
        policy: {
            noticeHours: Math.round(hours),
            lateFee: late.fee,
            noShowFee: noShow.fee,
            remedy: "refund",
        },
    };
}

/**
 * What the panel shows about the agreement clause. Three states, not two.
 *
 * ⚠️ The third one is why this is a function and not a boolean. The server
 * bumps `agreements.version` on every write and
 * `getCancellationAttestation()` returns null the moment the attested template
 * is edited — so "attested, then someone edited the agreement" is already
 * detectable for free. Reading that null is the whole drift check; do NOT
 * diff clause text to find it.
 */
export type ClauseState = "not-required" | "never-attested" | "attested" | "drifted";

export function clauseStateOf(input: {
    /** The policy as it is STORED, not as the form currently reads. */
    stored: CancellationPolicy | null;
    /** True when the tenant has attested and the attested version is current. */
    attestationCurrent: boolean;
    /** True when an attestation was recorded at some point. */
    everAttested: boolean;
    /** Whether the stored policy charges anything at all. */
    chargesFees: boolean;
}): ClauseState {
    if (!input.stored || !input.chargesFees) return "not-required";
    if (input.attestationCurrent) return "attested";
    return input.everAttested ? "drifted" : "never-attested";
}
