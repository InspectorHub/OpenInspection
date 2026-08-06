// @vitest-environment happy-dom
/**
 * The company-wide booking deposit (tier 1).
 *
 * The feature shipped with an API that accepted a deposit at all three tiers
 * and a booking flow that charged it, and no control anywhere — so the only way
 * to turn it on was a hand-written request. What is pinned here is not "the
 * panel renders": it is the two things that would move the wrong amount of
 * money if they drifted.
 *
 *   - the UNIT. A deposit percent is a whole percent, unlike the pay rule next
 *     door, which is basis points. 20 must reach the wire as 20.
 *   - the DEFAULT. NULL means no deposit, and every existing company is NULL.
 *     The control has to render that as an answer, not as a blank.
 *
 * Both assertions read the submitted body rather than the DOM, because the
 * SegmentedControl carries no hidden input: its value reaches the server only
 * because the component sends the state it owns.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { BookingPoliciesPanel } from "./BookingPoliciesPanel";
import type { DepositPolicy } from "../../../server/lib/billing/deposit-policy";

function renderPanel(depositPolicy: DepositPolicy | null) {
    const calls: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <BookingPoliciesPanel
                    initialConfig={{
                        conciergeReviewRequired: false,
                        blockUnsignedAgreement: false,
                        allowInspectorChoice: false,
                        depositPolicy,
                    }}
                />
            ),
            action: async ({ request }) => {
                const form = await request.formData();
                calls.push(Object.fromEntries(form) as Record<string, string>);
                return { ok: true, intent: "policies-save" };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return { calls };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: /save policies/i }));

describe("BookingPoliciesPanel — deposit", () => {
    it("shows an unconfigured company a deliberate no-deposit, not an empty field", () => {
        renderPanel(null);

        expect(screen.getByRole("radio", { name: "No deposit" }).getAttribute("aria-checked")).toBe("true");
        expect(screen.getByText(/not asked for anything up front/i)).toBeTruthy();
        // Nothing to fill in, so nothing that could look half-filled.
        expect(screen.queryByLabelText(/deposit percent/i)).toBeNull();
        expect(screen.queryByLabelText(/deposit amount/i)).toBeNull();
    });

    it("sends a whole percent, not basis points", async () => {
        const { calls } = renderPanel(null);

        fireEvent.click(screen.getByRole("radio", { name: "Percent of the price" }));
        fireEvent.change(screen.getByLabelText(/deposit percent/i), { target: { value: "20" } });
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        // 2000 here would ask a client for twenty times the price.
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "percent", percent: 20 }));
    });

    it("converts a typed dollar amount to integer cents", async () => {
        const { calls } = renderPanel(null);

        fireEvent.click(screen.getByRole("radio", { name: "Fixed amount" }));
        fireEvent.change(screen.getByLabelText(/deposit amount/i), { target: { value: "125" } });
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "fixed", amountCents: 12500 }));
    });

    it("refuses a zero percent rather than storing a policy that charges nothing", async () => {
        const { calls } = renderPanel(null);

        fireEvent.click(screen.getByRole("radio", { name: "Percent of the price" }));
        fireEvent.change(screen.getByLabelText(/deposit percent/i), { target: { value: "0" } });
        save();

        expect(await screen.findByText(/percent between 1 and 100/i)).toBeTruthy();
        expect(calls).toHaveLength(0);
    });

    it("clears the stored default when the company turns the deposit off", async () => {
        const { calls } = renderPanel({ type: "percent", percent: 20 });

        expect(screen.getByRole("radio", { name: "Percent of the price" }).getAttribute("aria-checked")).toBe("true");
        fireEvent.click(screen.getByRole("radio", { name: "No deposit" }));
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe("null");
    });
});
