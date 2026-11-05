// @vitest-environment happy-dom
/**
 * The booking wizard's bot challenge across its real state: the real `useBookingFormState` and the real `useTurnstileWidget`, with only
 * `window.turnstile` and `fetch` faked. The other wizard specs mock the form state, so they cannot see what the hook does with a token.
 *
 * A challenge token is good for one request. A submit that spent it (whatever the answer) must drop it and render the challenge again, so
 * the next submit cannot resend a spent token; an expired token must be dropped with a message; a widget error must read as "could not
 * load"; and a held token must still carry a successful submit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { BookingWizard } from "~/components/booking/BookingWizard";
import { useBookingFormState } from "~/components/booking/useBookingFormState";
import type { CompanyProfile } from "~/components/booking/booking-constants";

type Wired = { callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void };

const PROFILE: CompanyProfile = {
  company: "Seed Tenant A",
  turnstileSiteKey: "1x00000000000000000000AA",
  inspectors: [],
  services: [{ id: "svc", name: "Home inspection", price: 45000, duration: 180 }],
};

let renders: Wired[];
let removed: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let form: ReturnType<typeof useBookingFormState>;

function Harness() {
  form = useBookingFormState({ profile: PROFILE, preselected: null, tenant: "seed-a", agentRefSlug: null });
  return <BookingWizard profile={PROFILE} privacyUrl={null} termsUrl={null} form={form} />;
}

beforeEach(() => {
  renders = [];
  removed = [];
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: HTMLElement, opts: Wired) => { renders.push(opts); return `widget-${renders.length}`; },
    remove: (id: string) => { removed.push(id); },
  };
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  document.head.appendChild(script);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll("script").forEach((el) => el.remove());
  delete (window as unknown as { turnstile?: unknown }).turnstile;
  vi.unstubAllGlobals();
});

/** Mounts the wizard and walks the real state to the confirm step, where the challenge host exists. */
async function mountAtConfirm() {
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  render(<Stub initialEntries={["/"]} />);
  await act(async () => {
    form.setAddress("1 Main St");
    form.toggleService("svc");
    form.setInspectionDate("2099-06-18");
    form.setClientName("Dana Buyer");
    form.setClientEmail("dana@example.com");
    form.setStep(3);
  });
  await waitFor(() => expect(renders).toHaveLength(1));
}

const submitButton = () => screen.getByRole("button", { name: /request inspection/i });
const click = () => act(async () => { fireEvent.click(submitButton()); });
const solve = (n: number, token: string) => act(async () => { renders[n]!.callback(token); });
const sentToken = (call: number): unknown => JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string).turnstileToken;
const refused = () => ({ ok: false, json: async () => ({ error: { message: "Refused" } }) });
const accepted = () => ({ ok: true, json: async () => ({ data: { inspectionId: "insp-1", depositRequiredCents: 0 } }) });

describe("the booking wizard's challenge token", () => {
  it("(a) drops a token a failed submit spent, removes its widget, renders a fresh one, and does not resend the stale token", async () => {
    fetchMock.mockResolvedValueOnce(refused());
    await mountAtConfirm();
    await solve(0, "tok-1");
    await click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentToken(0)).toBe("tok-1");
    // The spent token's widget is removed and the challenge is rendered again.
    await waitFor(() => expect(renders).toHaveLength(2));
    expect(removed).toEqual(["widget-1"]);
    // Without a new answer the next click sends nothing and says to verify.
    await click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/complete the verification/i)).toBeTruthy();
    // Control: the new widget's token goes through.
    fetchMock.mockResolvedValueOnce(accepted());
    await solve(1, "tok-2");
    await click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentToken(1)).toBe("tok-2");
  });

  it("(b) drops an expired token with the verification message, and blocks the submit until a new token", async () => {
    await mountAtConfirm();
    await solve(0, "tok-old");
    await act(async () => { renders[0]!["expired-callback"]!(); });
    expect(screen.getByText(/complete the verification/i)).toBeTruthy();
    await click();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(accepted());
    await solve(0, "tok-new");
    // The new token ends the message the expiry left on screen.
    expect(screen.queryByText(/complete the verification/i)).toBeNull();
    await click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentToken(0)).toBe("tok-new");
  });

  it("(c) reads a widget error as the check not being able to load, and sends nothing", async () => {
    await mountAtConfirm();
    await act(async () => { renders[0]!["error-callback"]!(); });
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy());
    await click();
    expect(fetchMock).not.toHaveBeenCalled();
    // The widget recovering by itself (a new token) clears that message too.
    await solve(0, "tok-recovered");
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });

  it("(d) still submits successfully with the token held", async () => {
    fetchMock.mockResolvedValueOnce(accepted());
    await mountAtConfirm();
    await solve(0, "tok-held");
    await click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentToken(0)).toBe("tok-held");
    await waitFor(() => expect(form.bookedInspectionId).toBe("insp-1"));
    expect(form.message?.ok).toBe(true);
  });

  it("(e) after a booking was made the challenge is not rendered again and its host is gone", async () => {
    fetchMock.mockResolvedValueOnce(accepted());
    await mountAtConfirm();
    expect(form.turnstileRef.current).not.toBeNull();
    await solve(0, "tok-held");
    await click();
    await waitFor(() => expect(form.bookedInspectionId).toBe("insp-1"));
    // Nothing more is asked of this visitor: no second widget, and the host element is no longer on the page.
    expect(renders).toHaveLength(1);
    expect(form.turnstileRef.current).toBeNull();
  });
});
