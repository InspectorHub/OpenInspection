/**
 * Track I-a Task 8 — combined Sign & pay public page. The page's two-step
 * progress header (Sign / Pay) is driven entirely by deriveCheckoutState; the
 * canvas / Stripe Elements / waiting / completion UIs are Chrome-verified
 * (happy-dom has no component-render harness in this repo, per file-dropzone).
 */
import { describe, it, expect } from "vitest";
import {
    deriveCheckoutState,
    signStep,
    payStep,
    type CheckoutStateInput,
} from "~/lib/checkout-steps";
import { onBehalfPayload, EMPTY_ON_BEHALF } from "~/components/agreements/OnBehalfFields";

const base: CheckoutStateInput = {
    signerStatus: "viewed",
    progress: { signed: 0, total: 1 },
    completionPolicy: "all",
    payment: { required: true, paid: false },
    invoice: { status: "unpaid" },
};

describe("signStep", () => {
    it("todo while this signer has not signed", () => {
        expect(signStep({ ...base, signerStatus: "viewed" })).toBe("todo");
        expect(signStep({ ...base, signerStatus: "sent" })).toBe("todo");
    });

    it("done when this signer signed and the envelope is complete (policy=all, all signed)", () => {
        expect(signStep({ signerStatus: "signed", progress: { signed: 2, total: 2 }, completionPolicy: "all" })).toBe("done");
    });

    it("waiting when this signer signed but other signers are outstanding (policy=all)", () => {
        expect(signStep({ signerStatus: "signed", progress: { signed: 1, total: 2 }, completionPolicy: "all" })).toBe("waiting");
    });

    it("done when this signer signed under policy=one (a single signature completes it)", () => {
        expect(signStep({ signerStatus: "signed", progress: { signed: 1, total: 3 }, completionPolicy: "one" })).toBe("done");
    });
});

describe("payStep", () => {
    it("na when payment is not required", () => {
        expect(payStep({ payment: { required: false, paid: false }, invoice: null })).toBe("na");
    });

    it("todo when required + unpaid invoice", () => {
        expect(payStep({ payment: { required: true, paid: false }, invoice: { status: "unpaid" } })).toBe("todo");
    });

    it("todo when required + partial invoice", () => {
        expect(payStep({ payment: { required: true, paid: false }, invoice: { status: "partial" } })).toBe("todo");
    });

    it("done when the inspection payment status is paid", () => {
        expect(payStep({ payment: { required: true, paid: true }, invoice: { status: "unpaid" } })).toBe("done");
    });

    it("done when the invoice itself is paid", () => {
        expect(payStep({ payment: { required: true, paid: false }, invoice: { status: "paid" } })).toBe("done");
    });

    it("na when required but no invoice exists yet (nothing to pay)", () => {
        expect(payStep({ payment: { required: true, paid: false }, invoice: null })).toBe("na");
    });
});

describe("deriveCheckoutState", () => {
    it("fresh viewer: sign=todo, pay=todo, not complete", () => {
        const s = deriveCheckoutState(base);
        expect(s).toMatchObject({ sign: "todo", pay: "todo", allComplete: false, declined: false });
    });

    it("signed + paid → allComplete", () => {
        const s = deriveCheckoutState({
            ...base,
            signerStatus: "signed",
            progress: { signed: 1, total: 1 },
            payment: { required: true, paid: true },
        });
        expect(s.sign).toBe("done");
        expect(s.pay).toBe("done");
        expect(s.allComplete).toBe(true);
    });

    it("signed but waiting on co-signer → not complete even when paid", () => {
        const s = deriveCheckoutState({
            ...base,
            signerStatus: "signed",
            progress: { signed: 1, total: 2 },
            payment: { required: true, paid: true },
        });
        expect(s.sign).toBe("waiting");
        expect(s.allComplete).toBe(false);
    });

    it("signed + no payment required → allComplete", () => {
        const s = deriveCheckoutState({
            signerStatus: "signed",
            progress: { signed: 1, total: 1 },
            completionPolicy: "all",
            payment: { required: false, paid: false },
            invoice: null,
        });
        expect(s.pay).toBe("na");
        expect(s.allComplete).toBe(true);
    });

    it("declined surfaces the decline terminal and is never complete", () => {
        const s = deriveCheckoutState({ ...base, signerStatus: "declined" });
        expect(s.declined).toBe(true);
        expect(s.allComplete).toBe(false);
    });
});

describe("onBehalfPayload", () => {
    it("returns {} when the toggle is off", () => {
        expect(onBehalfPayload(EMPTY_ON_BEHALF)).toEqual({});
        expect(onBehalfPayload({ enabled: false, onBehalfOf: "x", onBehalfDisclaimer: "y" })).toEqual({});
    });

    it("includes trimmed onBehalfOf / onBehalfDisclaimer when enabled", () => {
        expect(onBehalfPayload({ enabled: true, onBehalfOf: "  Jane  ", onBehalfDisclaimer: "  POA  " }))
            .toEqual({ onBehalfOf: "Jane", onBehalfDisclaimer: "POA" });
    });

    it("omits empty fields even when enabled", () => {
        expect(onBehalfPayload({ enabled: true, onBehalfOf: "Jane", onBehalfDisclaimer: "  " }))
            .toEqual({ onBehalfOf: "Jane" });
        expect(onBehalfPayload({ enabled: true, onBehalfOf: "   ", onBehalfDisclaimer: "" }))
            .toEqual({});
    });
});
