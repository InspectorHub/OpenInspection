// @vitest-environment happy-dom
/**
 * BookingDepositPanel payment latch: two clicks dispatched in ONE frame start one payment-intent request, and
 * two submits of the Stripe Elements form confirm the payment once. The
 * pending button only goes inert after React renders, which is too late for
 * the second event.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { BookingDepositPanel } from "./BookingDepositPanel";

const stripe = vi.hoisted(() => ({ confirmPayment: vi.fn() }));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@stripe/react-stripe-js", () => ({
    Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PaymentElement: () => null,
    useStripe: () => stripe,
    useElements: () => ({}),
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const intentResponse = () =>
    new Response(JSON.stringify({ data: { clientSecret: "cs_1", publishableKey: "pk_1" } }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn(async () => intentResponse());
    vi.stubGlobal("fetch", fetchMock);
    stripe.confirmPayment.mockReset();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function mount() {
    const Stub = createRoutesStub([{ path: "/", Component: () => <BookingDepositPanel inspectionId="insp-1" depositCents={5000} currency="USD" companyName="Acme" /> }]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("BookingDepositPanel payment latch", () => {
    it("starts ONE payment intent for two same-frame clicks", async () => {
        mount();
        const start = screen.getByRole("button");
        act(() => { start.click(); start.click(); });
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("CONTROL - a single click starts the intent and mounts the card form", async () => {
        const { container } = mount();
        act(() => { screen.getByRole("button").click(); });
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(container.querySelector("form")).not.toBeNull();
    });

    it("confirms the payment ONCE for two same-frame submits, and again after a decline", async () => {
        stripe.confirmPayment.mockResolvedValue({ error: { message: "declined" } });
        const { container } = mount();
        act(() => { screen.getByRole("button").click(); });
        await settle();
        const form = container.querySelector("form") as HTMLFormElement;
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        await settle();
        expect(stripe.confirmPayment).toHaveBeenCalledTimes(1);

        act(() => { fireEvent.submit(form); });
        await settle();
        expect(stripe.confirmPayment).toHaveBeenCalledTimes(2);
    });
});
