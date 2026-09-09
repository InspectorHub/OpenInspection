// @vitest-environment happy-dom
/**
 * The invoice card does not offer to collect nothing.
 *
 * The card showed "$0.00" with a live "Request payment" button beside it, and
 * the modal behind that button gated its submit on the recipient's email and
 * never on the amount — so a client could be emailed a request to pay zero.
 *
 * WHY THE FIX IS "DO NOT OFFER IT" AND NOT "BLOCK $0":
 *
 *   A $0 INVOICE IS LEGITIMATE, and blocking that would have been the wrong
 *   lesson to draw. Surveyed 2026-09-07: Stripe finalizes a zero-total invoice
 *   straight to `paid` without attempting collection; ISN documents stamping
 *   PAID on an order "or has a total cost amounting to $0.00"; Canopy ships a
 *   zero-balance invoice specifically to "document work performed without
 *   charging the client" for courtesy work. Comped inspections are real.
 *
 *   What is not legitimate is ASKING SOMEONE TO PAY ZERO. So the card stops
 *   offering that action and says what to do instead, rather than presenting a
 *   button that leads to a dead end — the same reason the client-facing booking
 *   submit should never sit disabled with no explanation.
 *
 * `undefined` is deliberately NOT folded in with `0`: it means the viewer lacks
 * the `financial` capability and the amount is redacted, which is a permission
 * question this change has no business answering.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { InvoiceCard } from "~/components/inspector-portal/InvoiceCard";

function renderCard(amountCents: number | undefined) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <InvoiceCard
                    pill={{ tone: "monitor", label: "Unpaid" }}
                    amountCents={amountCents}
                    currency="USD"
                    paid={false}
                    sent={false}
                    payUrl={null}
                    hasServiceLines={false}
                    paymentRequired={false}
                    basePriceCents={amountCents}
                    canManagePrice
                    onRequestPayment={() => {}}
                />
            ),
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

describe("InvoiceCard request-payment affordance", () => {
    it("does not offer to request payment when the amount is zero", () => {
        renderCard(0);
        expect(screen.queryByRole("button", { name: /request payment/i })).toBeNull();
    });

    it("says why, and points at the next step", () => {
        renderCard(0);
        expect(screen.getByText(/set an amount/i)).toBeTruthy();
    });

    // POSITIVE CONTROL: with a real amount the button must still be there.
    // Without this, a card that dropped the button unconditionally would pass.
    it("offers it normally once there is something to collect", () => {
        renderCard(45000);
        expect(screen.getByRole("button", { name: /request payment/i })).toBeTruthy();
        expect(screen.queryByText(/set an amount/i)).toBeNull();
    });

    // PRECISION GUARD: `undefined` is money redacted for this viewer, not a
    // zero total. Folding the two together would silently change who may
    // request payment, which is a permission decision and not this fix.
    it("leaves the redacted-money case exactly as it was", () => {
        renderCard(undefined);
        expect(screen.getByRole("button", { name: /request payment/i })).toBeTruthy();
    });
});
