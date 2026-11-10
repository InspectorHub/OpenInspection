// @vitest-environment happy-dom
/**
 * The three booking checkboxes. The deposit has its own section
 * (`CollectPaymentPanel`), and what is pinned here is the boundary: saving these
 * must never carry, and so never clear, the deposit.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { BookingPoliciesPanel } from "./BookingPoliciesPanel";

function renderPanel() {
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

describe("BookingPoliciesPanel", () => {
    it("has no deposit control", async () => {
        renderPanel();
        await screen.findByRole("button", { name: /save policies/i });
        expect(screen.queryByLabelText(/deposit/i)).toBeNull();
    });

    it("saves the three policies without a depositPolicy key, so an unrelated save cannot clear the deposit", async () => {
        const { calls } = renderPanel();
        fireEvent.click(await screen.findByRole("button", { name: /save policies/i }));
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].intent).toBe("policies-save");
        expect("depositPolicy" in calls[0]).toBe(false);
    });
});
