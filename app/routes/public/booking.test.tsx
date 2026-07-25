/**
 * Booking on behalf of a client is the same booking page, not a third form.
 * A signed-in agent gets one page with a different destination: the company's
 * hold endpoint instead of the anonymous public one, no Turnstile (they are
 * authenticated), and the contact block relabeled as the CLIENT's details.
 *
 * An anonymous visitor must see exactly what they saw before.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import BookingPage from "~/routes/public/booking";

const PROFILE = {
  company: "Acme Inspections",
  services: [{ id: "svc-1", name: "Full Inspection", price: 45000, description: null, durationMinutes: 180 }],
  inspectors: [{ id: "insp-1", name: "Mike Reynolds", photoUrl: null }],
  allowInspectorChoice: true,
  bookingOpen: true,
  turnstileSiteKey: "1x00000000000000000000AA",
  conciergeReviewRequired: false,
};

function renderBooking(opts: {
  agentBooking?: { agentName: string; tenantId: string } | null;
  onAction?: (form: FormData) => unknown;
}) {
  const Stub = createRoutesStub([
    {
      path: "/book/:tenant",
      Component: BookingPage,
      loader: () => ({
        profile: PROFILE,
        preselected: null,
        error: null,
        tenant: "acme",
        agentRefSlug: null,
        brand: {},
        privacyUrl: null,
        termsUrl: null,
        agentBooking: opts.agentBooking ?? null,
      }),
      action: async ({ request }) =>
        opts.onAction ? opts.onAction(await request.formData()) : { ok: true },
    },
  ]);
  return render(<Stub initialEntries={["/book/acme"]} />);
}

describe("BookingPage — anonymous visitor", () => {
  it("shows no on-behalf-of banner and keeps the public flow", async () => {
    const { findByText, queryByText } = renderBooking({ agentBooking: null });
    await findByText("Acme Inspections");
    expect(queryByText(/on behalf of/i)).toBeNull();
  });
});

describe("BookingPage — prefill", () => {
  beforeEach(() => localStorage.clear());

  it("marks every field with the browser autofill token that matches it", async () => {
    const { findByPlaceholderText, container } = renderBooking({ agentBooking: null });
    const address = await findByPlaceholderText(/123 Main St/i);
    expect(address.getAttribute("autocomplete")).toBe("street-address");
    fireEvent.change(address, { target: { value: "123 Main St" } });
    fireEvent.click(await screen.findByText("Continue"));
    fireEvent.click(await screen.findByText("Full Inspection"));
    fireEvent.click(await screen.findByText("Continue"));
    expect(container.querySelector("input[type='email']")?.getAttribute("autocomplete")).toBe("email");
    expect(screen.getByPlaceholderText("Jane Doe").getAttribute("autocomplete")).toBe("name");
  });

  it("remembers the visitor's own contact details and offers to clear them", async () => {
    localStorage.setItem(
      "oi.booking.contact",
      JSON.stringify({ name: "Sarah Buyer", email: "sarah@example.com" }),
    );
    const { findByPlaceholderText } = renderBooking({ agentBooking: null });
    fireEvent.change(await findByPlaceholderText(/123 Main St/i), { target: { value: "1 A St" } });
    fireEvent.click(await screen.findByText("Continue"));
    fireEvent.click(await screen.findByText("Full Inspection"));
    fireEvent.click(await screen.findByText("Continue"));

    const name = screen.getByPlaceholderText("Jane Doe") as HTMLInputElement;
    expect(name.value).toBe("Sarah Buyer");
    // Says it is stored on this device, and lets a different visitor drop it.
    expect(screen.getByText(/this browser|this device/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/not you/i));
    expect((screen.getByPlaceholderText("Jane Doe") as HTMLInputElement).value).toBe("");
    expect(localStorage.getItem("oi.booking.contact")).toBeNull();
  });

  it("never prefills a remembered contact into an agent's booking — that would be someone else's client", async () => {
    localStorage.setItem(
      "oi.booking.contact",
      JSON.stringify({ name: "Sarah Buyer", email: "sarah@example.com" }),
    );
    const { findByPlaceholderText } = renderBooking({
      agentBooking: { agentName: "Jane Smith", tenantId: "t-1" },
    });
    fireEvent.change(await findByPlaceholderText(/123 Main St/i), { target: { value: "1 A St" } });
    fireEvent.click(await screen.findByText("Continue"));
    fireEvent.click(await screen.findByText("Full Inspection"));
    fireEvent.click(await screen.findByText("Continue"));

    const name = screen.getByPlaceholderText("Jane Doe") as HTMLInputElement;
    expect(name.value).toBe("");
    // The fields are the client's, so the browser's own saved identity is wrong here too.
    expect(name.getAttribute("autocomplete")).toBe("off");
  });
});

describe("BookingPage — signed-in agent", () => {
  it("says whose behalf the booking is on", async () => {
    const { findByText } = renderBooking({
      agentBooking: { agentName: "Jane Smith", tenantId: "t-1" },
    });
    expect(await findByText(/on behalf of a client/i)).toBeTruthy();
  });

  it("submits the hold to the route action instead of the anonymous endpoint", async () => {
    const submissions: FormData[] = [];
    const { findByText, getByPlaceholderText, container } = renderBooking({
      agentBooking: { agentName: "Jane Smith", tenantId: "t-1" },
      onAction: (form) => {
        submissions.push(form);
        return { ok: true };
      },
    });

    await findByText(/on behalf of a client/i);

    // Walk the wizard: address -> service -> schedule + client details.
    fireEvent.change(getByPlaceholderText(/123 Main St/i), { target: { value: "123 Main St" } });
    fireEvent.click(await findByText("Continue"));
    fireEvent.click(await findByText("Full Inspection"));
    fireEvent.click(await findByText("Continue"));

    const date = container.querySelector("input[type='date']") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-09-01" } });
    fireEvent.change(getByPlaceholderText("Jane Doe"), { target: { value: "Sarah Buyer" } });
    fireEvent.change(getByPlaceholderText("jane@example.com"), { target: { value: "sarah@example.com" } });
    fireEvent.click(await findByText("Continue"));

    fireEvent.click(await findByText("Request Inspection"));

    await waitFor(() => expect(submissions).toHaveLength(1));
    const form = submissions[0];
    expect(form.get("_intent")).toBe("agent-book");
    expect(form.get("address")).toBe("123 Main St");
    expect(form.get("clientName")).toBe("Sarah Buyer");
    expect(form.get("clientEmail")).toBe("sarah@example.com");
    expect(form.getAll("serviceId")).toEqual(["svc-1"]);
    // Tier 3 of prefill: the agent never types who they are. Their identity —
    // and therefore the referral credit — comes from the session on the server,
    // so nothing in the submission can be forged to claim someone else's.
    expect(form.get("agentRefSlug")).toBeNull();
    expect(form.get("agentUserId")).toBeNull();
    expect(form.get("tenantId")).toBeNull();
  });
});
