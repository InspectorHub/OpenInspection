// @vitest-environment happy-dom
/**
 * What the client is told about the deposit, and when.
 *
 * Two rules, and both of them are about not surprising anyone:
 *
 *  1. The amount is stated BEFORE the client commits. A charge discovered
 *     after clicking Book is a chargeback and a review, so the services step
 *     and the confirm summary both quote it, and both say it comes off the
 *     total rather than on top.
 *  2. The payment step only exists AFTER the booking does, and only when the
 *     SERVER says money is owed. A workspace with no deposit configured sees
 *     no payment step at all — the client-side quote can never conjure one,
 *     because the figure the panel charges is the one the server froze.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import BookingPage from "~/routes/public/booking";

type DepositPolicy = { type: "none" | "percent" | "fixed"; percent?: number; amountCents?: number } | null;
type BookingService = { id: string; name: string; price: number; duration: number; depositPolicy: DepositPolicy };

const BASE_SERVICES: BookingService[] = [
  { id: "svc-1", name: "Full Inspection", price: 45000, duration: 180, depositPolicy: null },
  { id: "svc-2", name: "Radon", price: 9500, duration: 60, depositPolicy: null },
];

const BASE_PROFILE = {
  company: "Acme Inspections",
  services: BASE_SERVICES,
  inspectors: [],
  allowInspectorChoice: false,
  bookingOpen: true,
  turnstileSiteKey: null,
  conciergeReviewRequired: false,
  currency: "USD",
  depositPolicy: null as DepositPolicy,
};

function renderBooking(profile: Partial<typeof BASE_PROFILE> = {}) {
  const Stub = createRoutesStub([
    {
      path: "/book/:tenant",
      Component: BookingPage,
      loader: () => ({
        profile: { ...BASE_PROFILE, ...profile },
        preselected: null, error: null, tenant: "acme", agentRefSlug: null,
        brand: {}, privacyUrl: null, termsUrl: null, agentBooking: null,
      }),
      action: async () => ({ ok: true }),
    },
  ]);
  return render(<Stub initialEntries={["/book/acme"]} />);
}

/** Walk the wizard to the step named, filling only what each gate requires. */
async function walkTo(step: "services" | "confirm") {
  fireEvent.change(await screen.findByPlaceholderText(/123 Main St/i), { target: { value: "123 Main St" } });
  fireEvent.click(await screen.findByText("Continue"));
  fireEvent.click(await screen.findByText("Full Inspection"));
  if (step === "services") return;
  fireEvent.click(await screen.findByText("Continue"));
  fireEvent.change(screen.getByPlaceholderText("Jane Doe"), { target: { value: "Jane Doe" } });
  fireEvent.change(screen.getByPlaceholderText("jane@example.com"), { target: { value: "jane@example.com" } });
  const date = document.querySelector("input[type='date']") as HTMLInputElement;
  fireEvent.change(date, { target: { value: "2026-09-10" } });
  fireEvent.click(await screen.findByText("Continue"));
}

describe("the deposit is quoted before the client commits", () => {
  it("states the amount on the services step, and that it comes off the total", async () => {
    renderBooking({ depositPolicy: { type: "percent", percent: 20 } });
    await walkTo("services");
    expect(await screen.findByText(/\$90\.00 is collected when you book/)).toBeTruthy();
    expect(screen.getByText(/comes off the total, not on top of it/)).toBeTruthy();
  });

  it("repeats it as a line on the confirm summary", async () => {
    renderBooking({ depositPolicy: { type: "percent", percent: 20 } });
    await walkTo("confirm");
    expect(await screen.findByText("Deposit due today")).toBeTruthy();
    expect(screen.getByText(/asked for a \$90\.00 deposit to hold this slot/)).toBeTruthy();
  });

  it("says nothing at all when the workspace asks for no deposit", async () => {
    renderBooking({ depositPolicy: null });
    await walkTo("confirm");
    expect(screen.queryByText("Deposit due today")).toBeNull();
    expect(screen.queryByText(/deposit/i)).toBeNull();
  });

  it("honours a service that opted out, so the quote matches what will be charged", async () => {
    renderBooking({
      depositPolicy: { type: "percent", percent: 20 },
      services: [{ id: "svc-1", name: "Full Inspection", price: 45000, duration: 180, depositPolicy: { type: "none" } }],
    });
    await walkTo("services");
    // Nothing is owed, so nothing is said — the alternative is quoting a figure
    // the server will not charge.
    expect(screen.queryByText(/is collected when you book/)).toBeNull();
  });
});

describe("the payment step appears only after the booking exists", () => {
  const submitBooking = async (response: unknown) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
    );
    renderBooking({ depositPolicy: { type: "percent", percent: 20 } });
    await walkTo("confirm");
    fireEvent.click(await screen.findByText("Request Inspection"));
  };

  it("shows it when the server froze an amount, and says the appointment is already booked", async () => {
    await submitBooking({ success: true, data: { success: true, inspectionId: "insp-a", depositRequiredCents: 9000 } });
    expect(await screen.findByText("Deposit to hold your slot")).toBeTruthy();
    expect(await screen.findByText("Pay $90.00 deposit")).toBeTruthy();
    // The single most important sentence on this panel.
    expect(screen.getByText(/Your appointment is already booked/)).toBeTruthy();
  });

  it("shows no payment step when the server froze nothing", async () => {
    await submitBooking({ success: true, data: { success: true, inspectionId: "insp-a", depositRequiredCents: 0 } });
    await waitFor(() => expect(screen.getByText("Request Submitted")).toBeTruthy());
    expect(screen.queryByText("Deposit to hold your slot")).toBeNull();
  });

  it("trusts the SERVER amount, not the client-side quote", async () => {
    // An operator overrode the deposit to $50 between the page load and the
    // submit. The panel must charge what the order says, not what the form
    // guessed from the catalogue.
    await submitBooking({ success: true, data: { success: true, inspectionId: "insp-a", depositRequiredCents: 5000 } });
    expect(await screen.findByText("Pay $50.00 deposit")).toBeTruthy();
    expect(screen.queryByText("Pay $90.00 deposit")).toBeNull();
  });
});
