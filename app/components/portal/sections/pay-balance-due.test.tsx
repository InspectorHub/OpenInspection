// @vitest-environment happy-dom
/**
 * The pay pages quote what the payer is CHARGED.
 *
 * The pay-intent route charges the outstanding balance (the invoice total minus
 * everything the payment ledger has received, a booking deposit included). These
 * pages used to quote the whole total, so a client who had paid a $100 deposit
 * on a $500 invoice was shown a $500 button and charged $400. Each surface now
 * takes the server's balance, and once the intent exists the button shows the
 * amount the server answered with.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { InvoiceDisplay } from "./InvoiceDisplay";
import { StripePayPanel } from "./StripePayPanel";
import type { InvoiceData } from "./payment-helpers";
import { PayCard } from "~/components/checkout/PayCard";
import type { TenantBrand } from "~/lib/brand";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@stripe/react-stripe-js", () => ({
    Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PaymentElement: () => null,
    useStripe: () => ({ confirmPayment: vi.fn() }),
    useElements: () => ({}),
}));

const BRAND = { companyName: "Acme Inspections", primaryColor: "#2563eb" } as TenantBrand;
/** A whole-dollar amount, whether or not the formatter prints the cents. */
const usd = (...amounts: number[]) => new RegExp(amounts.map((v) => `\\$${v}(\\.00)?(?!\\d)`).join("|"));
const settle =() => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const INVOICE: InvoiceData = {
    number: "INV-7", date: "2026-07-26", dueDate: null, status: "sent",
    clientName: "Dana", inspectorName: "Sam",
    lineItems: [{ description: "Home inspection", amount: 500 }],
    total: 500, balanceDue: 400,
};

function mount(node: React.ReactNode) {
    const Stub = createRoutesStub([{ path: "/", Component: () => <>{node}</> }]);
    return render(<Stub initialEntries={["/"]} />);
}

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
        new Response(JSON.stringify({ data: { clientSecret: "cs_1", publishableKey: "pk_1", amountCents: 40000 } }), { status: 200 })));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("InvoiceDisplay with a deposit already received", () => {
    it("asks for the balance, not the total, and shows what was paid", () => {
        mount(<InvoiceDisplay invoice={INVOICE} brand={BRAND} inspectionId="insp-1" portalToken="tok" justPaid={false} />);
        expect(screen.getByRole("button", { name: usd(400) })).toBeTruthy();
        expect(screen.queryByRole("button", { name: usd(500) })).toBeNull();
        expect(screen.getByText(/−\$100/)).toBeTruthy();
    });

    it("without a balance from the server it keeps quoting the total", () => {
        mount(<InvoiceDisplay invoice={{ ...INVOICE, balanceDue: undefined }} brand={BRAND} inspectionId="insp-1" portalToken="tok" justPaid={false} />);
        expect(screen.getByRole("button", { name: usd(500) })).toBeTruthy();
    });

    it("a fully covered invoice shows the paid state and no pay button", () => {
        mount(<InvoiceDisplay invoice={{ ...INVOICE, status: "paid", balanceDue: 0 }} brand={BRAND} inspectionId="insp-1" portalToken="tok" justPaid={false} />);
        expect(screen.queryByRole("button")).toBeNull();
    });
});

describe("after the intent exists, the button shows what the server charges", () => {
    it("StripePayPanel uses the pay-intent amount even if the page's own figure was stale", async () => {
        mount(<StripePayPanel id="insp-1" portalToken="tok" balanceDue={500} inspectorName="Sam" brandColor={null} />);
        expect(screen.getByRole("button", { name: usd(500) })).toBeTruthy();
        act(() => { screen.getByRole("button").click(); });
        await settle();
        const buttons = screen.getAllByRole("button");
        expect(buttons.some((b) => usd(400).test(b.textContent ?? ""))).toBe(true);
        expect(buttons.some((b) => usd(500).test(b.textContent ?? ""))).toBe(false);
    });

    it("PayCard takes the balance for the first quote and the pay-intent amount for the form", async () => {
        mount(<PayCard state="todo" invoice={{ id: "inv-1", amountCents: 50000, balanceDueCents: 45000, status: "partial" }} inspectionId="insp-1" brandColor={null} justPaid={false} companyName="Acme" portalToken="tok" />);
        expect(screen.getByRole("button", { name: usd(450) })).toBeTruthy();
        expect(screen.queryByRole("button", { name: usd(500) })).toBeNull();
        act(() => { screen.getByRole("button").click(); });
        await settle();
        const buttons = screen.getAllByRole("button");
        expect(buttons.some((b) => usd(400).test(b.textContent ?? ""))).toBe(true);
        expect(buttons.some((b) => usd(450, 500).test(b.textContent ?? ""))).toBe(false);
    });
});
