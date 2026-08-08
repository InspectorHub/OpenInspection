// @vitest-environment happy-dom
/**
 * The cancellation ladder and the agreement clause it depends on.
 *
 * What is pinned here is not "the panel renders". It is the four things that
 * would either charge a client money the agreement does not support, or silently
 * revoke the confirmation that makes the charge collectable.
 *
 *   - A fee with no current attestation MUST NOT be submitted. The server
 *     refuses it too; this is the gate that can say WHICH control is at fault.
 *   - `attestCancellationClause` MUST be absent from a save that confirms
 *     nothing. It is transient, and its `null` WITHDRAWS an attestation — so a
 *     helpful default on an unrelated fee edit would revoke the confirmation.
 *   - Zero on both rungs needs no clause at all. This is the INVERSION against
 *     the deposit next door, which refuses a zero outright.
 *   - Drift names the agreement and says the confirmation no longer applies.
 *
 * The first three read the submitted body rather than the DOM, because
 * `SegmentedControl` carries no hidden input — its value reaches the server only
 * because the component sends the state it owns.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { CancellationPolicyPanel, type ClauseState } from "./CancellationPolicyPanel";
import type { CancellationPolicy } from "../../../server/lib/billing/cancellation-policy";

const NO_CLAUSE: ClauseState = { current: false, everAttested: false, agreementId: null };
const ATTESTED: ClauseState = { current: true, everAttested: true, agreementId: "ag-1" };
const DRIFTED: ClauseState = { current: false, everAttested: true, agreementId: "ag-1" };

const AGREEMENTS = [{ id: "ag-1", name: "Standard inspection agreement" }];

const FEE_POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: "percent", percent: 50 },
    noShowFee: { type: "percent", percent: 100 },
    remedy: "refund",
};

const FREE_POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: "fixed", amountCents: 0 },
    noShowFee: { type: "fixed", amountCents: 0 },
    remedy: "refund",
};

function renderPanel(policy: CancellationPolicy | null, clause: ClauseState) {
    const calls: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <CancellationPolicyPanel policy={policy} clause={clause} agreements={AGREEMENTS} />
            ),
            action: async ({ request }) => {
                const form = await request.formData();
                calls.push(Object.fromEntries(form) as Record<string, string>);
                return { ok: true, intent: "cancellation-policy-save" };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return { calls };
}

const save = () =>
    fireEvent.click(screen.getByRole("button", { name: /save cancellation policy/i }));

describe("CancellationPolicyPanel — the clause gate", () => {
    it("refuses to submit a fee-bearing policy with no attestation on file", async () => {
        const { calls } = renderPanel(FEE_POLICY, NO_CLAUSE);
        save();
        // Asserted as "nothing was sent", not as "an error appeared". A panel
        // that showed the message AND submitted anyway would satisfy a
        // message-only assertion, and the server's refusal would then land as an
        // unexplained red line.
        await waitFor(() =>
            expect(screen.getByText(/confirm the agreement clause/i)).toBeTruthy(),
        );
        expect(calls).toHaveLength(0);
    });

    it("submits once the clause is confirmed in the same save", async () => {
        // The control: without it, the case above passes against a panel whose
        // save button does nothing at all.
        const { calls } = renderPanel(FEE_POLICY, NO_CLAUSE);
        fireEvent.change(screen.getByLabelText(/agreement containing the clause/i), {
            target: { value: "ag-1" },
        });
        save();
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]?.attestCancellationClause).toBe("ag-1");
    });

    it("omits attestCancellationClause entirely when nothing is being confirmed", async () => {
        // The trap this exists for: the key is transient and its null WITHDRAWS
        // the attestation. Editing a fee on an already-confirmed policy must not
        // mention it at all.
        const { calls } = renderPanel(FEE_POLICY, ATTESTED);
        save();
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]).not.toHaveProperty("attestCancellationClause");
    });

    it("needs no clause when both rungs are zero", async () => {
        // The inversion against the deposit: a zero deposit is refused because a
        // deposit of nothing reads as configured and behaves as off. A zero
        // cancellation fee is a real answer — "we do not charge for this" — and
        // demanding an attestation for it would force every company that charges
        // nothing to confirm a clause it does not need.
        const { calls } = renderPanel(FREE_POLICY, NO_CLAUSE);
        save();
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(screen.queryByText(/confirm the agreement clause/i)).toBeNull();
    });
});

describe("CancellationPolicyPanel — the clause appears with the INTENT to charge", () => {
    it("asks for the clause as soon as a fee type is picked, before any number is typed", () => {
        // Found in the browser, invisible to every assertion above. The clause
        // block was gated on the PARSED policy, so choosing "Percent of the
        // price" with an empty box removed the "you charge nothing" line and put
        // nothing in its place — no requirement, no guidance, no error. The
        // clause is a precondition of the intent, so it appears with the intent.
        renderPanel(null, NO_CLAUSE);
        expect(screen.getByText(/you charge nothing/i)).toBeTruthy();

        // `role="radio"`, not button — SegmentedControl follows the WAI-ARIA
        // radiogroup pattern. [0] is the late rung; picking either is enough.
        fireEvent.click(screen.getAllByRole("radio", { name: /percent of the price/i })[0]!);

        expect(screen.queryByText(/you charge nothing/i)).toBeNull();
        expect(screen.getByText(/only collectable if the agreement/i)).toBeTruthy();
    });

    it("points a workspace with no agreements at where to make one", () => {
        // "Create one" is not actionable from a settings panel. AGREEMENTS is
        // empty in this case, which is the state a brand-new workspace is in.
        const Stub = createRoutesStub([
            {
                path: "/",
                Component: () => (
                    <CancellationPolicyPanel policy={FEE_POLICY} clause={NO_CLAUSE} agreements={[]} />
                ),
            },
        ]);
        render(<Stub initialEntries={["/"]} />);
        const link = screen.getByRole("link", { name: /create an agreement/i });
        expect(link.getAttribute("href")).toBe("/agreements");
    });
});

describe("CancellationPolicyPanel — drift", () => {
    it("names the agreement and says the confirmation no longer applies", () => {
        renderPanel(FEE_POLICY, DRIFTED);
        const drift = screen.getByText(/no longer applies/i);
        expect(drift.textContent).toContain("Standard inspection agreement");
        // The surprising half: ANY edit clears it, including one unrelated to the
        // clause. Left undocumented, this arrives as a failed save the operator
        // cannot account for.
        expect(drift.textContent).toMatch(/any edit clears it/i);
    });

    it("distinguishes never-confirmed from confirmed-then-changed", () => {
        renderPanel(FEE_POLICY, NO_CLAUSE);
        // Both states refuse the fee, but they ask for different things — one is
        // "choose an agreement", the other is "check it again". Collapsing them
        // sends a company hunting for a confirmation it already made.
        expect(screen.queryByText(/no longer applies/i)).toBeNull();
        expect(screen.getByText(/only collectable if the agreement/i)).toBeTruthy();
    });
});
