// @vitest-environment happy-dom
/**
 * The settings page must believe the API when it says a company is connected.
 *
 * This page used to decide that question with `status?.connected`, reading a
 * field the API has never sent: the route hand-declared its own `QboStatus`
 * shape carrying a `connected: boolean` and cast the JSON body to it, while
 * the value actually on the wire is `QBOConnectionStatus`, which has no such
 * field. The flag was therefore permanently `undefined`, so a fully connected
 * company saw the "Connect QuickBooks" call-to-action and could never reach
 * Sync, Pause, Disconnect, the refresh-token expiry warning, or the items that
 * need attention. Nothing caught it: fourteen server specs exercise the
 * integration, and none of them crosses the seam where the shape is retyped by
 * hand.
 *
 * So the payload below is typed as the SERVER's return type. If a future
 * change adds a field the page needs, or renames one it reads, this stops
 * compiling -- which is the protection the hand-written interface gave up.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, within, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import Route, { meta, type QboLoaderData } from "./settings-integrations-qbo";
import type { QBOConnectionStatus, QBOCredentialSource } from "../../server/services/qbo/api-base";

afterEach(cleanup);

const HOUR = 3600;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

/** Exactly what `GET /api/integrations/qbo/status` puts in `data`. */
const CONNECTED: QBOConnectionStatus = {
  realmId: "9341457665739480",
  companyName: "Sandbox Company US baeb",
  lastSyncAt: NOW_SECONDS - HOUR,
  syncEnabled: true,
  openErrors: [],
  paymentDiscrepancies: [],
  heldDepositCount: 0,
  refreshTokenExpiresAt: NOW_SECONDS + 100 * 24 * HOUR,
  connectedAt: NOW_SECONDS - 30 * 24 * HOUR,
  environment: "sandbox",
  mappedCustomers: 41,
  mappedInvoices: 96,
  credentialSource: { clientId: "env", clientSecret: "env", webhookToken: "env", environment: "env" },
};

const ROW = {
  id: "err-1", oiType: "invoice", oiId: "inv-00001234", errorCode: "SYNC_ERROR",
  message: "QuickBooks refused the invoice", retries: 2, lastSeenAt: NOW_SECONDS,
};

const NO_SECRETS = { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "" };
const ALL_MISSING: QBOCredentialSource = { clientId: "missing", clientSecret: "missing", webhookToken: "missing", environment: "missing" };
const NO_OAUTH = { connected: false, error: null };

/** Anything a person must never read on this page, in any state. */
const FORBIDDEN_WORDS = /workspace|tenant|platform|deployment|saas|hosted/i;

interface Call { intent: string; fields: Record<string, string> }

function renderPage(
  status: QBOConnectionStatus | null,
  overrides: Partial<QboLoaderData> = {},
  opts: {
    loader?: () => QboLoaderData;
    action?: (call: Call) => unknown;
  } = {},
) {
  const calls: Call[] = [];
  const Stub = createRoutesStub([
    {
      path: "/settings/integrations/qbo",
      Component: Route,
      loader: opts.loader ?? ((): QboLoaderData => ({
        access: "ok",
        status,
        secrets: NO_SECRETS,
        // One published app serves everyone is the default: that is what almost
        // every company is, and it is the case where the form must NOT appear.
        selfHosted: false,
        credentialSource: status?.credentialSource ?? ALL_MISSING,
        environment: status?.environment ?? null,
        registration: null,
        oauth: NO_OAUTH,
        ...overrides,
      })),
      action: async ({ request }) => {
        const fd = await request.formData();
        const fields = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
        const call = { intent: fields.intent ?? "", fields };
        calls.push(call);
        return (opts.action ? opts.action(call) : { success: true, intent: call.intent, error: null }) as never;
      },
    },
  ]);
  const view = render(<Stub initialEntries={["/settings/integrations/qbo"]} />);
  return { ...view, calls };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("QuickBooks settings page - connection state", () => {
  it("shows the connected company and its controls when the API returns a connection", async () => {
    renderPage(CONNECTED);

    // The company name only renders inside the connected branch.
    expect(await screen.findByText("Sandbox Company US baeb")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Automatic sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect from QuickBooks" })).toBeInTheDocument();
    // The call-to-action for an unconnected company must be gone.
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

describe("QuickBooks settings page - frame", () => {
  it("sets the document title", () => {
    expect(meta()).toEqual([{ title: "QuickBooks Integration - OpenInspection" }]);
  });

  it("opens with the breadcrumb, a heading and the one-line description", async () => {
    renderPage(CONNECTED);

    const crumb = await screen.findByRole("navigation", { name: /breadcrumb/i });
    expect(within(crumb).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(crumb).getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/settings/integrations");
    // The last crumb is where you are, not a link.
    expect(within(crumb).getByText("QuickBooks Online")).toBeInTheDocument();
    expect(within(crumb).queryByRole("link", { name: "QuickBooks Online" })).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1, name: "QuickBooks Online" })).toBeInTheDocument();
    expect(screen.getByText(/OpenInspection stays the source of truth/)).toBeInTheDocument();
  });

  it("puts the connection first, then what needs attention, then matching, then the Intuit app", async () => {
    renderPage({ ...CONNECTED, openErrors: [ROW] }, {
      selfHosted: true,
      credentialSource: CONNECTED.credentialSource,
      environment: "sandbox",
    });
    await screen.findByText("Sandbox Company US baeb");

    const order = ["Sandbox Company US baeb", "1 item needs attention", "Contact matching", "Your Intuit app"].map(
      (name) => screen.getByRole("heading", { name }),
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("QuickBooks settings page - who may see it", () => {
  it("says what is needed instead of rendering a misleading 'not connected' to someone without the role", async () => {
    renderPage(null, { access: "forbidden" });

    expect(await screen.findByText(/Only owners and managers can manage the QuickBooks connection/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect to quickbooks/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /connect quickbooks online/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Your Intuit app/)).not.toBeInTheDocument();
  });

  it("does not show that notice to an owner or manager (control)", async () => {
    renderPage(null);
    await screen.findByRole("link", { name: /connect to quickbooks/i });
    expect(screen.queryByText(/Only owners and managers can manage/)).not.toBeInTheDocument();
  });

  it("does not render the credentials for someone without the role, even on a self-run app", async () => {
    renderPage(null, { access: "forbidden", selfHosted: true });
    await screen.findByText(/Only owners and managers can manage/);
    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
  });
});

describe("QuickBooks settings page - wording", () => {
  it.each([
    ["connected", () => renderPage({ ...CONNECTED, openErrors: [ROW], heldDepositCount: 2 }, { selfHosted: true })],
    ["not connected, managed app", () => renderPage(null)],
    ["not connected, own app, set up", () => renderPage(null, { selfHosted: true })],
    ["without the role", () => renderPage(null, { access: "forbidden" })],
  ] as const)("never uses internal vocabulary - %s", async (_name, mount) => {
    const { container } = mount();
    await screen.findByRole("heading", { level: 1 });
    await settle();
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
  });
});

/**
 * Intuit's listing requirements are specific about this control, and using
 * outdated or unapproved QuickBooks imagery is among the most common reasons an
 * app fails review. The artwork ships in `public/intuit/`, taken verbatim from
 * Intuit's asset bundle; nothing here may recolour or resize it.
 */
describe("QuickBooks settings page - Intuit button requirements", () => {
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

  it("keeps the connect link to the OAuth start when the app is ready, and blocks it when an own app is not", async () => {
    renderPage(null, { selfHosted: true, credentialSource: { ...ALL_MISSING, clientId: "env", clientSecret: "env", environment: "env" }, environment: "sandbox" });
    const ready = await screen.findByRole("link", { name: /connect to quickbooks/i });
    expect(ready).toHaveAttribute("href", "/api/integrations/qbo/connect");
    cleanup();

    renderPage(null, { selfHosted: true });
    const blocked = await screen.findByRole("link", { name: /connect to quickbooks/i });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
  });
});

/**
 * `api/qbo-oauth.ts` reports every outcome of the handshake -- success and each
 * distinct failure -- by redirecting to this page with a query parameter. The
 * page read none of them, so a user who clicked Connect with no credentials,
 * or whose `state` had expired, or who declined at Intuit, landed back on an
 * unchanged page and was told nothing at all.
 */
describe("QuickBooks settings page - OAuth round-trip outcome", () => {
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

    // Who sets QBO_ENV differs by setup -- an operator who runs their own
    // Intuit app does it beside their credentials, anyone else never sees it.
    // In neither case is a missing Client ID the problem, and pointing at a
    // field that is already correct is how the reader loses an hour.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("QBO_ENV");
    expect(alert).not.toHaveTextContent(/client id/i);
  });

  it("still renders an error code it does not recognize", async () => {
    renderPage(null, { oauth: { connected: false, error: "some_new_intuit_code" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("some_new_intuit_code");
  });

  it("says nothing when the page was not reached through the callback", async () => {
    renderPage(null);
    await screen.findByRole("link", { name: /connect to quickbooks/i });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

/**
 * Who owns the Intuit app decides whether this section exists.
 *
 * A company on a shared deployment never supplies one -- a single published app
 * serves everyone. A self-run deploy answers on its own domain, and Intuit
 * matches a redirect URI byte for byte, so the shared app cannot work there.
 * The section is therefore not something we hide from one group; it is a
 * question the other group is never asked.
 */
describe("QuickBooks settings page - who owns the Intuit app", () => {
  it("asks for no credentials at all when one app serves everyone", async () => {
    renderPage(null);

    await screen.findByRole("link", { name: /connect to quickbooks/i });
    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/intuit environment/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your Intuit app" })).not.toBeInTheDocument();
  });

  it("gives an operator who runs their own app all four settings, environment included", async () => {
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
 * A deployment may supply the QuickBooks credentials through its environment,
 * in which case nothing is stored and the form has nothing to mask. Calling
 * that "Not configured" told a working setup the opposite of the truth -- which
 * is exactly what the live sandbox connection showed.
 */
describe("QuickBooks settings page - credential provenance", () => {
  it("marks settings that are built in rather than calling them unset, and keeps the others honest", async () => {
    renderPage(null, {
      selfHosted: true,
      credentialSource: { clientId: "env", clientSecret: "env", webhookToken: "missing", environment: "missing" },
    });

    // The one that is not supplied keeps the honest "unset" copy.
    expect(await screen.findByLabelText(/webhook/i)).toHaveAttribute("placeholder", "Not configured");
    // The built-in ones are named, and still overridable.
    fireEvent.click(screen.getAllByRole("button", { name: "Override" })[0]);
    expect(await screen.findByLabelText(/client id/i)).toHaveAttribute("placeholder", "Built in. Type to override");
  });

  it("calls every setting unset when nothing supplies any", async () => {
    renderPage(null, { selfHosted: true });

    expect(await screen.findByLabelText(/client id/i)).toHaveAttribute("placeholder", "Not configured");
  });
});

describe("QuickBooks settings page - feedback bars", () => {
  async function openAndSave(action: (call: Call) => unknown) {
    const page = renderPage(null, { selfHosted: true }, { action });
    const form = (await screen.findByLabelText(/client id/i)).closest("form");
    if (!form) throw new Error("no credentials form");
    await act(async () => { fireEvent.submit(form); });
    await settle();
    return page;
  }

  it("flashes 'Credentials saved.' after a successful save", async () => {
    await openAndSave((c) => ({ success: true, intent: c.intent, error: null }));
    expect(await screen.findByRole("status")).toHaveTextContent("Credentials saved.");
  });

  it("lets the saved flash go again after four seconds", async () => {
    await openAndSave((c) => ({ success: true, intent: c.intent, error: null }));
    expect(await screen.findByRole("status")).toHaveTextContent("Credentials saved.");

    // Real time on purpose: the page owns this timer, and faking it would also
    // freeze the router that the rest of this file depends on.
    await waitFor(() => expect(screen.queryByText("Credentials saved.")).not.toBeInTheDocument(), { timeout: 6000 });
  }, 12000);

  it("shows the server's message when the save is refused, and no success flash", async () => {
    await openAndSave((c) => ({ success: false, intent: c.intent, error: 'QBO_ENV must be exactly "sandbox" or "production"' }));
    expect(await screen.findByRole("alert")).toHaveTextContent('QBO_ENV must be exactly "sandbox" or "production"');
    expect(screen.queryByText("Credentials saved.")).not.toBeInTheDocument();
  });

  it("surfaces a failed Sync now, which used to fail without a word", async () => {
    const { calls } = renderPage(CONNECTED, {}, { action: (c) => ({ success: false, intent: c.intent, error: "Could not start the sync. Try again." }) });
    await screen.findByText("Sandbox Company US baeb");
    await act(async () => { screen.getByRole("button", { name: "Sync now" }).click(); });
    await settle();

    expect(calls.map((c) => c.intent)).toEqual(["qbo-sync"]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start the sync. Try again.");
  });
});

describe("QuickBooks settings page - Sync now", () => {
  it("reaches the action once for two clicks in the same frame, and again afterwards", async () => {
    const { calls } = renderPage(CONNECTED);
    await screen.findByText("Sandbox Company US baeb");

    const btn = screen.getByRole("button", { name: "Sync now" });
    act(() => { btn.click(); btn.click(); });
    await settle();
    expect(calls.map((c) => c.intent)).toEqual(["qbo-sync"]);

    act(() => { screen.getByRole("button", { name: "Sync now" }).click(); });
    await settle();
    expect(calls.map((c) => c.intent)).toEqual(["qbo-sync", "qbo-sync"]);
  });
});

describe("QuickBooks settings page - after a sync", () => {
  it("moves the last-sync line on from the loader's fresh answer, without a reload", async () => {
    let lastSyncAt: number | null = null;
    renderPage(CONNECTED, {}, {
      loader: () => ({
        access: "ok", status: { ...CONNECTED, lastSyncAt }, secrets: NO_SECRETS,
        selfHosted: false, credentialSource: CONNECTED.credentialSource, environment: "sandbox",
        registration: null, oauth: NO_OAUTH,
      }),
      action: (c) => {
        lastSyncAt = Math.floor(Date.now() / 1000) - 30;
        return { success: true, intent: c.intent, error: null };
      },
    });
    expect(await screen.findByText("Not synced yet")).toBeInTheDocument();

    await act(async () => { screen.getByRole("button", { name: "Sync now" }).click(); });
    await settle();

    await waitFor(() => expect(screen.getByText(/Last sync/)).toBeInTheDocument());
    expect(screen.queryByText("Not synced yet")).not.toBeInTheDocument();
  });
});

describe("QuickBooks settings page - Automatic sync", () => {
  it("follows the server's answer, not the click", async () => {
    let serverEnabled = true;
    const { calls } = renderPage(CONNECTED, {}, {
      loader: () => ({
        access: "ok", status: { ...CONNECTED, syncEnabled: serverEnabled }, secrets: NO_SECRETS,
        selfHosted: false, credentialSource: CONNECTED.credentialSource, environment: "sandbox",
        registration: null, oauth: NO_OAUTH,
      }),
      action: (c) => {
        serverEnabled = false;
        return { success: true, intent: c.intent, error: null, syncEnabled: false };
      },
    });
    const sw = await screen.findByRole("switch", { name: "Automatic sync" });
    expect(sw).toHaveAttribute("aria-checked", "true");

    act(() => { sw.click(); sw.click(); });
    await settle();

    expect(calls.map((c) => c.intent)).toEqual(["qbo-pause"]);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Automatic sync" })).toHaveAttribute("aria-checked", "false"),
    );
    expect(screen.getByTestId("qbo-status-pill")).toHaveTextContent("Paused");
  });

  it("leaves the switch where it was when the answer does not say (no guessing)", async () => {
    const { calls } = renderPage(CONNECTED, {}, {
      action: (c) => ({ success: true, intent: c.intent, error: null, syncEnabled: undefined }),
    });
    const sw = await screen.findByRole("switch", { name: "Automatic sync" });
    await act(async () => { sw.click(); });
    await settle();

    expect(calls.map((c) => c.intent)).toEqual(["qbo-pause"]);
    expect(screen.getByRole("switch", { name: "Automatic sync" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("QuickBooks settings page - Dismiss", () => {
  const page = (mode: "ok" | "fail") => {
    let rows = [ROW];
    return renderPage({ ...CONNECTED, openErrors: [ROW] }, {}, {
      loader: () => ({
        access: "ok", status: { ...CONNECTED, openErrors: rows }, secrets: NO_SECRETS,
        selfHosted: false, credentialSource: CONNECTED.credentialSource, environment: "sandbox",
        registration: null, oauth: NO_OAUTH,
      }),
      action: (c) => {
        if (mode === "fail") return { success: false, intent: c.intent, error: "Could not dismiss this item. Try again." };
        rows = [];
        return { success: true, intent: c.intent, error: null, errorId: c.fields.errorId };
      },
    });
  };

  it("sends the row's id, once for a double click, and drops the row", async () => {
    const { calls } = page("ok");
    const btn = await screen.findByRole("button", { name: "Dismiss" });
    act(() => { btn.click(); btn.click(); });
    await settle();

    expect(calls.map((c) => [c.intent, c.fields.errorId])).toEqual([["qbo-dismiss-error", "err-1"]]);
    await waitFor(() => expect(screen.queryByText("QuickBooks refused the invoice")).not.toBeInTheDocument());
  });

  it("keeps the row, shows why, and lets it be tried again when the dismiss fails", async () => {
    const { calls } = page("fail");
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    await act(async () => { dismiss.click(); });
    await settle();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not dismiss this item. Try again.");
    expect(screen.getByText("QuickBooks refused the invoice")).toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Dismiss" });
    expect(again).not.toHaveAttribute("aria-disabled");
    await act(async () => { again.click(); });
    await settle();
    expect(calls).toHaveLength(2);
  });
});

describe("QuickBooks settings page - Disconnect", () => {
  function statefulPage() {
    let connected = true;
    return renderPage(CONNECTED, {}, {
      loader: () => ({
        access: "ok", status: connected ? CONNECTED : null, secrets: NO_SECRETS,
        selfHosted: false, credentialSource: CONNECTED.credentialSource, environment: "sandbox",
        registration: null, oauth: NO_OAUTH,
      }),
      action: (c) => {
        if (c.intent === "qbo-disconnect") connected = false;
        return { success: true, intent: c.intent, error: null };
      },
    });
  }

  it("opens a confirmation first and sends nothing until it is confirmed", async () => {
    const { calls } = statefulPage();
    const open = await screen.findByRole("button", { name: "Disconnect from QuickBooks" });
    await act(async () => { open.click(); });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Disconnect from QuickBooks?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("41 contacts and 96 invoices");
    await settle();
    expect(calls).toHaveLength(0);

    // Keeping the connection closes it without a request.
    await act(async () => { within(dialog).getByRole("button", { name: "Keep connected" }).click(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toHaveLength(0);
    expect(screen.getByText("Sandbox Company US baeb")).toBeInTheDocument();
  });

  it("disconnects once on confirm - even for two clicks in one frame - and returns to the connect card", async () => {
    const { calls } = statefulPage();
    const open = await screen.findByRole("button", { name: "Disconnect from QuickBooks" });
    await act(async () => { open.click(); });
    const confirm = within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect from QuickBooks" });

    act(() => { confirm.click(); confirm.click(); });
    await settle();

    expect(calls.map((c) => c.intent)).toEqual(["qbo-disconnect"]);
    expect(await screen.findByRole("link", { name: /connect to quickbooks/i })).toBeInTheDocument();
    expect(screen.queryByText("Sandbox Company US baeb")).not.toBeInTheDocument();
  });
});
