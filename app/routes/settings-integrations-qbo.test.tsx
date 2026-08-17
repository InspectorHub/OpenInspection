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
  openErrors: [],
  paymentDiscrepancies: [],
  heldDepositCount: 0,
  refreshTokenExpiresAt: NOW_SECONDS + 100 * 24 * HOUR,
};

const NO_SECRETS = { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "", QBO_ENV: "" };
const NO_ENV = { QBO_CLIENT_ID: false, QBO_CLIENT_SECRET: false, QBO_WEBHOOK_SECRET: false, QBO_ENV: false };
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
        // A platform deployment is the default: that is what almost every
        // tenant is, and it is the case where the form must NOT appear.
        selfHosted: false,
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
    expect(screen.getByRole("button", { name: "Disconnect from QuickBooks" })).toBeInTheDocument();
    // The call-to-action for an unconnected tenant must be gone.
    expect(screen.queryByRole("link", { name: /connect to quickbooks/i })).not.toBeInTheDocument();
  });

  it("shows the connect call-to-action when the API returns no connection", async () => {
    renderPage(null);

    expect(
      await screen.findByRole("link", { name: /connect to quickbooks/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sandbox Company US baeb")).not.toBeInTheDocument();
  });
});

/**
 * Intuit's listing requirements are specific about this control, and using
 * outdated or unapproved QuickBooks imagery is among the most common reasons an
 * app fails review. The artwork ships in `public/intuit/`, taken verbatim from
 * Intuit's asset bundle; nothing here may recolour or resize it.
 */
describe("QuickBooks settings page — Intuit button requirements", () => {
  it("uses Intuit's own artwork for the connect control", async () => {
    renderPage(null);

    const link = await screen.findByRole("link", { name: /connect to quickbooks/i });
    const img = link.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/intuit/C2QB_green_btn_med_default.svg");
  });

  it("carries the hover artwork too, which the guidelines require", async () => {
    renderPage(null);

    const link = await screen.findByRole("link", { name: /connect to quickbooks/i });
    const sources = [...link.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(sources).toContain("/intuit/C2QB_green_btn_med_hover.svg");
  });

  it("titles the disconnect control the way Intuit requires", async () => {
    // Not "Disconnect". The guidelines name the string: a button or link
    // titled "Disconnect from QuickBooks".
    renderPage(CONNECTED);

    expect(
      await screen.findByRole("button", { name: "Disconnect from QuickBooks" }),
    ).toBeInTheDocument();
  });

  it("shows no connect artwork once a company is connected", async () => {
    // The same requirement from the other side: the button must disappear, not
    // merely be pushed below the fold.
    renderPage(CONNECTED);

    await screen.findByText("Sandbox Company US baeb");
    expect(document.querySelector('img[src^="/intuit/"]')).toBeNull();
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

  it("names the environment as the problem, not the credentials", async () => {
    renderPage(null, { oauth: { connected: false, error: "missing_qbo_env" } });

    // Who sets QBO_ENV differs by deployment — a self-hoster does it on the
    // form beside their own credentials, a platform tenant never sees it. In
    // neither case is a missing Client ID the problem, and pointing at a field
    // that is already correct is how the reader loses an hour.
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
 * Who owns the Intuit app decides whether this form exists.
 *
 * A tenant on a platform deployment never supplies one — a single published app
 * serves everyone, which is what every competitor does too. A self-hosted deploy
 * answers on its own domain, and Intuit matches a redirect URI byte for byte, so
 * the platform's app cannot work there. The form is therefore not a thing we
 * hide from SaaS tenants; it is a question they are never asked.
 */
describe("QuickBooks settings page — who owns the Intuit app", () => {
  it("asks a platform tenant for no credentials at all", async () => {
    renderPage(null);

    await screen.findByRole("link", { name: /connect to quickbooks/i });
    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/intuit environment/i)).not.toBeInTheDocument();
  });

  it("gives a self-hosted deployment all four settings, environment included", async () => {
    renderPage(null, { selfHosted: true });

    expect(await screen.findByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client secret/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/webhook/i)).toBeInTheDocument();
    // The fourth. QBO_ENV used to be settable only by redeploying, which is not
    // something the operator of a one-click deploy can necessarily do.
    expect(screen.getByLabelText(/intuit environment/i)).toBeInTheDocument();
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
      selfHosted: true,
      envProvided: {
        QBO_CLIENT_ID: true, QBO_CLIENT_SECRET: true,
        QBO_WEBHOOK_SECRET: false, QBO_ENV: false,
      },
    });

    expect(await screen.findByLabelText(/client id/i)).toHaveAttribute(
      "placeholder",
      "Provided by this deployment",
    );
    // The one the deployment does NOT supply keeps the honest "unset" copy.
    expect(screen.getByLabelText(/webhook/i)).toHaveAttribute("placeholder", "Not configured");
  });

  it("calls every field unset when the deployment supplies none", async () => {
    renderPage(null, { selfHosted: true });

    expect(await screen.findByLabelText(/client id/i)).toHaveAttribute(
      "placeholder",
      "Not configured",
    );
  });
});
