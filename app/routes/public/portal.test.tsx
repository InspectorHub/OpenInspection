/**
 * Spec 3 Task 7b — portal request-link success state cold-trail recovery
 * guidance.
 *
 * When find-my-report/portal request-link matches nothing, the success state
 * previously went silent after "Check your inbox" — a client who mistyped or
 * used a different email would wait for an email that never arrives. Fix: a
 * match-agnostic guidance line rendered INSIDE the existing single success
 * state (no new "not found" branch — anti-enumeration is preserved because
 * the copy never reveals match status).
 *
 * This test asserts the guidance renders identically regardless of whether
 * the submitted email matched an account — there is no branch in the
 * component, so both cases exercise the exact same render path, but the
 * assertion is written per-submission to guard against a future regression
 * that reintroduces a match-status branch.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import PortalLanding from "~/routes/public/portal";
import { EMPTY_BRAND } from "~/lib/brand";

afterEach(() => cleanup());

const RECOVERY_TEXT =
  /Didn.t get an email within a few minutes\? Check your spam folder and make sure you used the same email your inspector has on file\. Still stuck\? Contact your inspection company\./;

function renderPage(actionImpl: (args: { request: Request }) => unknown) {
  const Stub = createRoutesStub([
    {
      path: "/portal/:tenant",
      Component: PortalLanding,
      action: actionImpl,
      loader: () => ({ authed: false as const, tenant: "acme", brand: EMPTY_BRAND }),
    },
  ]);
  return render(<Stub initialEntries={["/portal/acme"]} />);
}

async function submitEmail(email: string) {
  const emailInput = await screen.findByLabelText(/email address/i);
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.click(screen.getByText(/email me a sign-in link/i));
  await waitFor(() => expect(screen.getByText(/check your email/i)).toBeTruthy());
}

describe("PortalLanding request-link success state — recovery guidance", () => {
  it("renders the recovery guidance for a matching email", async () => {
    renderPage(async () => ({ sent: true }));
    await submitEmail("matches@example.com");
    expect(screen.getByText(RECOVERY_TEXT)).toBeTruthy();
  });

  it("renders the SAME recovery guidance for a non-matching email (anti-enumeration)", async () => {
    renderPage(async () => ({ sent: true }));
    await submitEmail("no-such-account@example.com");
    expect(screen.getByText(RECOVERY_TEXT)).toBeTruthy();
  });

  it("keeps the existing hedged confirmation line unchanged, guidance appended below it", async () => {
    renderPage(async () => ({ sent: true }));
    await submitEmail("someone@example.com");
    expect(
      screen.getByText(/If an account matches that address, a link is on its way\. It expires in 15 minutes\./),
    ).toBeTruthy();
    expect(screen.getByText(RECOVERY_TEXT)).toBeTruthy();
  });
});
