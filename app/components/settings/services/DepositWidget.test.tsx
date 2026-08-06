// @vitest-environment happy-dom
/**
 * The per-service booking deposit (tier 2).
 *
 * One invariant carries this whole tier: a service with NO policy inherits the
 * company default, and a service with `{ type: 'none' }` refuses it. They are
 * one keystroke apart in the picker and opposite answers on the invoice — a
 * control that collapsed them would quietly charge a deposit on every add-on a
 * company had excused, and the booking page would look right while doing it.
 *
 * The unit is the second thing pinned. This widget is PayRuleWidget's twin
 * everywhere except the arithmetic: a pay rate goes out as basis points and a
 * deposit percent goes out as a whole percent, so the copied-looking code must
 * NOT have copied the x100.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { DepositWidget } from "./DepositWidget";
import type { DepositPolicy } from "../../../../server/lib/billing/deposit-policy";

function renderWidget(
    policy: DepositPolicy | null,
    companyDefault: DepositPolicy | null = { type: "percent", percent: 20 },
) {
    const calls: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <DepositWidget serviceId="svc-1" policy={policy} companyDefault={companyDefault} />
            ),
            action: async ({ request }) => {
                const form = await request.formData();
                calls.push(Object.fromEntries(form) as Record<string, string>);
                return { ok: true, intent: "deposit-policy-save", serviceId: "svc-1" };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return { calls };
}

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /change deposit/i }));
const chooseType = (label: RegExp | string) =>
    fireEvent.change(screen.getByLabelText("Deposit"), { target: { value: label } });
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

describe("DepositWidget", () => {
    it("says what an inheriting service inherits, instead of showing a blank", () => {
        renderWidget(null);
        expect(screen.getByText(/company default \(20% of the price\)/i)).toBeTruthy();
    });

    it("distinguishes opting out from inheriting", async () => {
        const { calls } = renderWidget(null);

        openPanel();
        chooseType("none");
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        // NOT "null": this service refuses the company's 20%, it does not merely
        // fail to have an opinion.
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "none" }));
    });

    it("hands a service back to the company default", async () => {
        const { calls } = renderWidget({ type: "none" });

        expect(screen.getByText(/no deposit/i)).toBeTruthy();
        openPanel();
        chooseType("inherit");
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe("null");
    });

    it("sends a whole percent, not the basis points its twin sends", async () => {
        const { calls } = renderWidget(null);

        openPanel();
        chooseType("percent");
        fireEvent.change(screen.getByLabelText(/deposit percent/i), { target: { value: "35" } });
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "percent", percent: 35 }));
    });

    it("converts a typed dollar amount to integer cents", async () => {
        const { calls } = renderWidget(null);

        openPanel();
        chooseType("fixed");
        fireEvent.change(screen.getByLabelText(/deposit amount/i), { target: { value: "150" } });
        save();

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "fixed", amountCents: 15000 }));
    });

    it("refuses an empty amount rather than saving a deposit of nothing", async () => {
        const { calls } = renderWidget(null);

        openPanel();
        chooseType("fixed");
        save();

        expect(await screen.findByText(/amount greater than zero/i)).toBeTruthy();
        expect(calls).toHaveLength(0);
    });
});
