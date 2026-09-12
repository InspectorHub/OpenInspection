// @vitest-environment happy-dom
/**
 * F26 — Settings › Billing rendered the SELF-HOSTED page on hosted SaaS.
 *
 * Four sentences, each the opposite of what the same application was doing:
 * "no subscription required" and "no per-seat charge" beside a Team page reading
 * `2 of 3 seats used`; "no quotas in standalone mode" against a lifetime cap the
 * quota guard enforces; and an invitation to "Try the hosted version" shown to
 * somebody already on it.
 *
 * The cause was not a missing branch — the page had one. It read `hasBilling`
 * and `hasSeatQuota` off the billing-summary payload with `= false` defaults,
 * and `summariseSeats` has never returned either field, so the answer was
 * `false` on every deployment that has ever existed. Whether a deployment bills
 * is a property of the DEPLOYMENT: it lives on the deployment profile and ships
 * through `deploymentPayload`.
 *
 * These tests drive the real route with the two deployment payloads and assert
 * on the SENTENCES a reader sees, not on which branch ran.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import SettingsBillingPage from "~/routes/settings-billing";

const SELF_HOSTED_CLAIMS = [
  /Self-hosted deployment — no subscription required/,
  /Self-hosted · no subscription/,
  /No quotas in standalone mode/,
  /Try the hosted version/,
];

function renderBilling(deployment: { hasBilling: boolean; hasSeatQuota: boolean }) {
  const context = {
    branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
    user: { capabilities: {} },
    deployment: { mode: deployment.hasBilling ? "saas" : "standalone", ...deployment },
  };
  const Stub = createRoutesStub([
    {
      // The id `useSessionContext` reads through `useRouteLoaderData`.
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({ context }),
      Component: () => <Outlet />,
      children: [
        {
          path: "settings/billing",
          Component: SettingsBillingPage,
          loader: () => ({
            // Exactly what `GET /api/billing/summary` returns — note that
            // neither `hasBilling` nor `hasSeatQuota` is in it. That is the
            // point: the page may not get those answers from here.
            billing: { tier: "free", seatsUsed: 2, maxUsers: 3, permanent: 2, portalUrl: null },
          }),
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/settings/billing"]} />);
}

describe("Settings › Billing — which deployment is this?", () => {
  it("says none of the self-hosted things on a deployment that bills", async () => {
    renderBilling({ hasBilling: true, hasSeatQuota: true });
    // Positive control: the page really rendered.
    expect(await screen.findByText(/Manage your subscription, seats, and invoices/)).toBeTruthy();

    for (const claim of SELF_HOSTED_CLAIMS) {
      expect(screen.queryByText(claim), String(claim)).toBeNull();
    }
  });

  it("shows the seat count against its cap when the deployment has a seat quota", async () => {
    renderBilling({ hasBilling: true, hasSeatQuota: true });
    expect(await screen.findByText(/Current plan/)).toBeTruthy();
    // 2 of 3 — the number the Team page was already showing while this page
    // said there was no per-seat charge.
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("still tells a genuinely self-hosted deployment the truth", async () => {
    renderBilling({ hasBilling: false, hasSeatQuota: false });
    expect(await screen.findByText(/Self-hosted deployment — no subscription required/)).toBeTruthy();
    expect(screen.getByText(/Try the hosted version/)).toBeTruthy();
    // …and does not offer a plan card built from a subscription it does not have.
    expect(screen.queryByText(/Current plan/)).toBeNull();
  });
});
