/**
 * Track I-a Task 8 — pure step-state derivation for the combined Sign & pay
 * public page. Kept framework-free so it can be unit-tested without a DOM.
 *
 * The checkout page has two ordered steps:
 *   1. Sign  — derived from this signer's status + the envelope progress.
 *   2. Pay   — derived from the inspection payment flag + invoice status.
 *
 * Each step resolves to one of three display states:
 *   - "todo"        action still required from this user
 *   - "waiting"     this user is done but the envelope isn't complete yet
 *                   (sign only — waiting on the OTHER signers)
 *   - "done"        nothing left to do for this step
 *   - "na"          step does not apply (pay only — no payment required)
 */

export type SignerStatus =
    | "pending"
    | "sent"
    | "viewed"
    | "signed"
    | "declined"
    | "expired";

export type StepState = "todo" | "waiting" | "done" | "na";

export interface CheckoutStateInput {
    signerStatus: SignerStatus;
    progress: { signed: number; total: number };
    completionPolicy: "all" | "one";
    payment: { required: boolean; paid: boolean };
    /** Present only when an invoice exists for the inspection. */
    invoice: { status: "paid" | "partial" | "unpaid" } | null;
}

export interface CheckoutState {
    sign: StepState;
    pay: StepState;
    /** True when every step is in a terminal "done" / "na" state. */
    allComplete: boolean;
    /** True when this signer declined — the page shows a decline terminal. */
    declined: boolean;
}

/** Has THIS signer finished signing? */
export function signStep(input: Pick<CheckoutStateInput, "signerStatus" | "progress" | "completionPolicy">): StepState {
    if (input.signerStatus === "signed") {
        // This signer is done. The whole envelope may still be open when the
        // completion policy needs every signer and others haven't signed yet.
        const envelopeComplete =
            input.completionPolicy === "one"
                ? input.progress.signed >= 1
                : input.progress.total > 0 && input.progress.signed >= input.progress.total;
        return envelopeComplete ? "done" : "waiting";
    }
    return "todo";
}

/** Is payment satisfied (or not applicable)? */
export function payStep(input: Pick<CheckoutStateInput, "payment" | "invoice">): StepState {
    // Payment only applies when the inspection requires it AND there is an
    // outstanding (non-paid) invoice. A paid invoice or paid inspection → done.
    if (!input.payment.required) return "na";
    if (input.payment.paid) return "done";
    if (input.invoice && input.invoice.status === "paid") return "done";
    if (!input.invoice) return "na"; // required but nothing to pay yet
    return "todo";
}

export function deriveCheckoutState(input: CheckoutStateInput): CheckoutState {
    const declined = input.signerStatus === "declined";
    const sign = signStep(input);
    const pay = payStep(input);
    const payTerminal = pay === "done" || pay === "na";
    return {
        sign,
        pay,
        // "All done" means this signer has nothing left to do AND the envelope
        // is fully signed (sign === "done", not merely "waiting") AND pay is
        // settled / not applicable.
        allComplete: sign === "done" && payTerminal && !declined,
        declined,
    };
}
