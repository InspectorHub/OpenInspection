// @vitest-environment happy-dom
/**
 * The settings page must believe the API when it says a company is connected.
 *
 * This page used to decide that question with `status?.connected`, reading a
 * field the API has never sent: the route hand-declared its own `QboStatus`
 * shape carrying a `connected: boolean` and cast the JSON body to it, while
 * the value actually on the wire is `QBOConnectionStatus`, which has no such
 * field. The flag was therefore permanently `undefined`, so a fully connected
 * tenant saw the "Connect QuickBooks" call-to-action and could never reach
 * Sync, Pause, Disconnect, the refresh-token expiry warning, or Books Health.
 * Nothing caught it: fourteen server specs exercise the integration, and none
 * of them crosses the seam where the shape is retyped by hand.
 *
 * So the payload below is typed as the SERVER's return type. If a future
 * change adds a field the page needs, or renames one it reads, this stops
 * compiling — which is the protection the hand-written interface gave up.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import Route, { type QboLoaderData } from "./settings-integrations-qbo";
import type { QBOConnectionStatus } from "../../server/services/qbo/api-base";

const HOUR = 3600;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

/** Exactly what `GET /settings/integrations/qbo/status` puts in `data`. */
const CONNECTED: QBOConnectionStatus = {
  realmId: "9341457665739480",
  companyName: "Sandbox Company US baeb",
  lastSyncAt: NOW_SECONDS - HOUR,
  syncEnabled: true,
  openErrors: 0,
  paymentDiscrepancies: [],
  heldDepositCount: 0,
  refreshTokenExpiresAt: NOW_SECONDS + 100 * 24 * HOUR,
};

const NO_SECRETS = { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "" };
const NO_ENV = { QBO_CLIENT_ID: false, QBO_CLIENT_SECRET: false, QBO_WEBHOOK_SECRET: false };
const NO_OAUTH = { connected: false, error: null };

function renderPage(
  status: QBOConnectionStatus | null,
  overrides: Partial<QboLoaderData> = {},
) {
  const Stub = createRoutesStub([
    {
      path: "/settings/integrations/qbo",
      Component: Route,
      loader: (): QboLoaderData => ({
        status,
        secrets: NO_SECRETS,
        envProvided: NO_ENV,
        oauth: NO_OAUTH,
        ...overrides,
      }),
    },
  ]);
  return render(<Stub initialEntries={["/settings/integrations/qbo"]} />);
}

describe("QuickBooks settings page — connection state", () => {
  it("shows the connected company and its controls when the API returns a connection", async () => {
    renderPage(CONNECTED);

    // The company name only renders inside the connected branch.
    expect(await screen.findByText("Sandbox Company US baeb")).toBeInTheDocument();
    // And the actions that branch gates. "Pause Sync" is the third; it is not
    // asserted separately because it swaps to "Resume Sync" with syncEnabled.
    expect(screen.getByRole("button", { name: "Sync Now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    // The call-to-action for an unconnected tenant must be gone.
    expect(screen.queryByRole("link", { name: /connect quickbooks/i })).not.toBeInTheDocument();
  });

  it("shows the connect call-to-action when the API returns no connection", async () => {
    renderPage(null);

    expect(
      await screen.findByRole("link", { name: /connect quickbooks/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sandbox Company US baeb")).not.toBeInTheDocument();
  });
});

/**
 * `api/qbo-oauth.ts` reports every outcome of the handshake — success and each
 * distinct failure — by redirecting to this page with a query parameter. The
 * page read none of them, so a user who clicked Connect with no credentials,
 * or whose `state` had expired, or who declined at Intuit, landed back on an
 * unchanged page and was told nothing at all.
 */
describe("QuickBooks settings page — OAuth round-trip outcome", () => {
  it("reports success after the callback redirects with connected=1", async () => {
    renderPage(CONNECTED, { oauth: { connected: true, error: null } });

    expect(await screen.findByRole("status")).toHaveTextContent("QuickBooks connected.");
  });

  it("explains a missing-credential bounce instead of returning silently", async () => {
    renderPage(null, { oauth: { connected: false, error: "not_configured" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/credentials are missing/i);
  });

  it("points a missing QBO_ENV at the administrator, not at the form", async () => {
    renderPage(null, { oauth: { connected: false, error: "missing_qbo_env" } });

    // QBO_ENV is env-only in every deployment mode; the credentials form on
    // this page cannot set it, so the copy must not send the reader there.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("QBO_ENV");
    expect(alert).not.toHaveTextContent(/client id/i);
  });

  it("still renders an error code it does not recognize", async () => {
    renderPage(null, { oauth: { connected: false, error: "some_new_intuit_code" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("some_new_intuit_code");
  });

  it("says nothing when the page was not reached through the callback", () => {
    renderPage(null);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

/**
 * A deployment may supply the QuickBooks credentials through its Worker env,
 * in which case the tenant has nothing stored and the form has nothing to
 * mask. Calling that "Not configured" told a working tenant the opposite of
 * the truth — which is exactly what the live sandbox connection showed.
 */
describe("QuickBooks settings page — credential provenance", () => {
  it("marks fields the deployment supplies rather than calling them unset", async () => {
    renderPage(null, {
      envProvided: { QBO_CLIENT_ID: true, QBO_CLIENT_SECRET: true, QBO_WEBHOOK_SECRET: false },
    });

    expect(await screen.findByLabelText(/client id/i)).toHaveAttribute(
      "placeholder",
      "Provided by this deployment",
    );
    // The one the deployment does NOT supply keeps the honest "unset" copy.
    expect(screen.getByLabelText(/webhook/i)).toHaveAttribute("placeholder", "Not configured");
  });

  it("calls every field unset when the deployment supplies none", async () => {
    renderPage(null);

    expect(await screen.findByLabelText(/client id/i)).toHaveAttribute(
      "placeholder",
      "Not configured",
    );
  });
});
