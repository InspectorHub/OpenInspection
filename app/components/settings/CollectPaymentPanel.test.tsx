// @vitest-environment happy-dom
/**
 * "Collect payment when clients book".
 *
 * Two things move money wrongly if they drift, and both are read off the
 * submitted body, not the DOM (the SegmentedControl carries no hidden input):
 *   - the UNIT: a deposit percent is a whole percent, so 100 reaches the wire as 100
 *   - the DEFAULT: no deposit is NULL, and every existing company is NULL
 * The rest pins what an owner needs to see: whether Stripe can take a card, and
 * whether deposits are on.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { CollectPaymentPanel } from "./CollectPaymentPanel";
import type { DepositPolicy } from "../../../server/lib/billing/deposit-policy";
import type { StripeStatus } from "~/lib/settings/stripe-status";

function renderPanel(
    depositPolicy: DepositPolicy | null | undefined,
    stripe: StripeStatus = "connected",
    currency?: string,
) {
    const calls: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <CollectPaymentPanel depositPolicy={depositPolicy} stripe={stripe} {...(currency ? { currency } : {})} />,
            action: async ({ request }) => {
                calls.push(Object.fromEntries(await request.formData()) as Record<string, string>);
                return { ok: true, intent: "deposit-save" };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return { calls };
}

const live = () => screen.getByRole("status");
const status = () => screen.getByTestId("collect-status").textContent ?? "";

describe("CollectPaymentPanel states", () => {
    it("deposits off, Stripe missing: says both, links to the Stripe settings, no warning yet", async () => {
        renderPanel(null, "not_connected");
        expect(await screen.findByText("Not connected")).toBeTruthy();
        expect(status()).toMatch(/^Off/);
        expect(screen.getByRole("link", { name: /open stripe settings/i }).getAttribute("href")).toBe("/settings/integrations#stripe");
        expect(live().textContent).toBe("");
        expect(screen.queryByRole("button", { name: /stop charging/i })).toBeNull();
    });

    it("deposits on, Stripe missing: warns that clients cannot pay yet", async () => {
        renderPanel({ type: "percent", percent: 100 }, "not_connected");
        expect(await screen.findByTestId("collect-warning")).toBeTruthy();
        expect(status()).toMatch(/^On.*full fee/);
        expect(live().textContent).toMatch(/clients cannot pay yet/i);
    });

    it("deposits on, Stripe keys incomplete: same warning, different Stripe label", async () => {
        renderPanel({ type: "fixed", amountCents: 7500 }, "attention");
        expect(await screen.findByText("Keys incomplete")).toBeTruthy();
        expect(status()).toContain("$75.00");
        expect(live().textContent).toMatch(/clients cannot pay yet/i);
    });

    it("deposits on, Stripe connected: no warning and no link", async () => {
        renderPanel({ type: "percent", percent: 25 }, "connected");
        expect(await screen.findByText("Connected")).toBeTruthy();
        expect(status()).toContain("25%");
        expect(live().textContent).toBe("");
        expect(screen.queryByRole("link", { name: /open stripe settings/i })).toBeNull();
    });

    it("an unreadable Stripe answer is never shown as connected", async () => {
        renderPanel(null, "unknown");
        expect(await screen.findByText("Could not check")).toBeTruthy();
        expect(screen.queryByText("Connected")).toBeNull();
    });

    it("opens the editor for a stored partial deposit", async () => {
        renderPanel({ type: "percent", percent: 20 });
        expect(await screen.findByLabelText(/deposit percent/i)).toBeTruthy();
    });
});

describe("CollectPaymentPanel saves", () => {
    it("the full-fee preset is one click and sends 100, not 10000", async () => {
        const { calls } = renderPanel(null);
        fireEvent.click(await screen.findByRole("button", { name: /charge the full fee when booking/i }));
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]).toMatchObject({ intent: "deposit-save", depositPolicy: JSON.stringify({ type: "percent", percent: 100 }) });
    });

    it("sends a whole percent from the deposit editor", async () => {
        const { calls } = renderPanel(null);
        fireEvent.click(await screen.findByRole("button", { name: /charge a deposit/i }));
        fireEvent.change(screen.getByLabelText(/deposit percent/i), { target: { value: "20" } });
        fireEvent.click(screen.getByRole("button", { name: /save deposit/i }));
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "percent", percent: 20 }));
    });

    it("converts a typed dollar amount to integer cents", async () => {
        const { calls } = renderPanel(null);
        fireEvent.click(await screen.findByRole("button", { name: /charge a deposit/i }));
        fireEvent.click(screen.getByRole("radio", { name: "Fixed amount" }));
        fireEvent.change(screen.getByLabelText(/deposit amount/i), { target: { value: "125" } });
        fireEvent.click(screen.getByRole("button", { name: /save deposit/i }));
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe(JSON.stringify({ type: "fixed", amountCents: 12500 }));
    });

    it("refuses a zero percent rather than storing a policy that charges nothing", async () => {
        const { calls } = renderPanel(null);
        fireEvent.click(await screen.findByRole("button", { name: /charge a deposit/i }));
        fireEvent.change(screen.getByLabelText(/deposit percent/i), { target: { value: "0" } });
        fireEvent.click(screen.getByRole("button", { name: /save deposit/i }));
        expect(await screen.findByText(/percent between 1 and 100/i)).toBeTruthy();
        expect(calls).toHaveLength(0);
    });

    it("clears the stored default when the owner stops charging", async () => {
        const { calls } = renderPanel({ type: "percent", percent: 100 });
        fireEvent.click(await screen.findByRole("button", { name: /stop charging when booking/i }));
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].depositPolicy).toBe("null");
    });

    it("two clicks in one frame send one request", async () => {
        const { calls } = renderPanel(null);
        const btn = await screen.findByRole("button", { name: /charge the full fee when booking/i });
        fireEvent.click(btn);
        fireEvent.click(btn);
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(calls).toHaveLength(1);
    });
});

describe("CollectPaymentPanel live region", () => {
    it("exists, empty, before anything happens, and receives the saved text", async () => {
        renderPanel(null);
        const region = await screen.findByRole("status");
        expect(region.textContent).toBe("");
        expect(region.getAttribute("aria-live")).toBe("polite");
        fireEvent.click(await screen.findByRole("button", { name: /charge the full fee when booking/i }));
        await waitFor(() => expect(screen.getByTestId("collect-saved")).toBeTruthy());
        // The very same node that was there before, now holding the text.
        expect(screen.getByRole("status")).toBe(region);
        expect(region.textContent).toMatch(/saved/i);
    });
});

describe("CollectPaymentPanel preset selection", () => {
    it("shows exactly one preset as chosen after opening the editor from the full fee", async () => {
        renderPanel({ type: "percent", percent: 100 });
        const full = await screen.findByRole("button", { name: /charge the full fee when booking/i });
        const deposit = screen.getByRole("button", { name: /charge a deposit/i });
        expect(full.getAttribute("aria-pressed")).toBe("true");
        expect(deposit.getAttribute("aria-pressed")).not.toBe("true");
        fireEvent.click(deposit);
        expect(full.getAttribute("aria-pressed")).not.toBe("true");
        expect(deposit.getAttribute("aria-pressed")).toBe("true");
    });
});

describe("CollectPaymentPanel for a caller who cannot see the deposit", () => {
    it("says the owner manages it and offers nothing to press", async () => {
        renderPanel(undefined, "connected");
        expect(await screen.findByTestId("collect-owner-managed")).toBeTruthy();
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByTestId("collect-status")).toBeNull();
    });

    it("a stored null still reads as off and still offers the presets", async () => {
        renderPanel(null);
        expect(await screen.findByRole("button", { name: /charge the full fee when booking/i })).toBeTruthy();
        expect(screen.queryByTestId("collect-owner-managed")).toBeNull();
    });
});

describe("CollectPaymentPanel in the company's currency", () => {
    it("formats a stored fixed deposit in GBP, not as dollars", async () => {
        renderPanel({ type: "fixed", amountCents: 7500 }, "connected", "GBP");
        await screen.findByTestId("collect-status");
        expect(status()).toContain("£75.00");
        expect(status()).not.toContain("$");
    });

    it("formats a stored fixed deposit in EUR with the euro sign, and the editor input too", async () => {
        renderPanel({ type: "fixed", amountCents: 7500 }, "connected", "EUR");
        await screen.findByTestId("collect-status");
        expect(status()).toContain("€75.00");
        expect(status()).not.toContain("$");
        const amount = screen.getByLabelText(/deposit amount/i) as HTMLInputElement;
        expect(amount.placeholder).toContain("€");
        expect(amount.value).toContain("€75");
    });
});
