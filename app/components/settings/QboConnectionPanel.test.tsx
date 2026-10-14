// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoutesStub } from "react-router";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { QboConnectionPanel } from "./QboConnectionPanel";
import type { QBOConnectionStatus } from "../../../server/services/qbo/api-base";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

const HOUR = 3600;
const DAY = 24 * HOUR;
const NOW = Math.floor(Date.now() / 1000);

const STATUS: QBOConnectionStatus = {
  realmId: "9341457665739480",
  companyName: "Sandbox Company US baeb",
  lastSyncAt: NOW - HOUR,
  syncEnabled: true,
  openErrors: [],
  paymentDiscrepancies: [],
  heldDepositCount: 0,
  refreshTokenExpiresAt: NOW + 100 * DAY,
  connectedAt: Date.UTC(2026, 9, 14, 12) / 1000,
  environment: "sandbox",
  mappedCustomers: 41,
  mappedInvoices: 96,
  credentialSource: { clientId: "env", clientSecret: "env", webhookToken: "env", environment: "env" },
};

async function view(over: Partial<QBOConnectionStatus> = {}, handlers: Partial<React.ComponentProps<typeof QboConnectionPanel>> = {}) {
  const props = {
    status: { ...STATUS, ...over },
    busy: false,
    syncing: false,
    dismissingId: null,
    onSync: vi.fn(),
    onToggleAuto: vi.fn(),
    onRequestDisconnect: vi.fn(),
    onDismissError: vi.fn(),
    ...handlers,
  };
  const Stub = createRoutesStub([{ path: "/", Component: () => <QboConnectionPanel {...props} /> }]);
  let utils!: ReturnType<typeof render>;
  await act(async () => { utils = render(<Stub initialEntries={["/"]} />); });
  return { ...utils, props };
}

const failedRow = {
  id: "e1", oiType: "invoice", oiId: "inv-0001", errorCode: "SYNC_ERROR",
  message: "refused", retries: 1, lastSeenAt: 1,
};

const PILLS = ["Active", "Paused", "Needs attention", "Reconnect needed"];

function pill() {
  return screen.getByTestId("qbo-status-pill");
}

describe("QboConnectionPanel - status pill", () => {
  it.each<[string, Partial<QBOConnectionStatus>]>([
    ["Active", {}],
    ["Paused", { syncEnabled: false }],
    ["Needs attention", { openErrors: [failedRow] }],
    ["Reconnect needed", { refreshTokenExpiresAt: NOW + 10 * DAY }],
  ])("shows %s, and only that one of the four", async (label, over) => {
    await view(over);
    expect(pill()).toHaveTextContent(label);
    for (const other of PILLS.filter((p) => p !== label)) {
      expect(pill()).not.toHaveTextContent(other);
    }
  });

  it("reads 'Reconnect needed' once the token has already expired, ahead of every other state", async () => {
    await view({ refreshTokenExpiresAt: NOW - DAY, openErrors: [failedRow], syncEnabled: false });
    expect(pill()).toHaveTextContent("Reconnect needed");
  });

  it("puts items that need a decision ahead of a paused sync", async () => {
    await view({ openErrors: [failedRow], syncEnabled: false });
    expect(pill()).toHaveTextContent("Needs attention");
    expect(pill()).not.toHaveTextContent("Paused");
  });

  it("stays Active for a token with more than 30 days left (control)", async () => {
    await view({ refreshTokenExpiresAt: NOW + 31 * DAY });
    expect(pill()).toHaveTextContent("Active");
  });
});

describe("QboConnectionPanel - the connection card", () => {
  it("names the company and falls back when QuickBooks gave no name", async () => {
    await view();
    expect(screen.getByRole("heading", { name: "Sandbox Company US baeb" })).toBeInTheDocument();
    cleanup();
    await view({ companyName: null });
    expect(screen.getByRole("heading", { name: "Connected" })).toBeInTheDocument();
  });

  it("shows the environment badge from the status, and none when it is unknown", async () => {
    await view({ environment: "production" });
    expect(screen.getByText("Production")).toBeInTheDocument();
    cleanup();
    await view({ environment: null });
    expect(screen.queryByText("Production")).not.toBeInTheDocument();
    expect(screen.queryByText("Sandbox")).not.toBeInTheDocument();
  });

  it("shows the company id with a copy button that writes it to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await view();
    expect(screen.getByText("9341457665739480")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy QuickBooks company ID" }));
    expect(writeText).toHaveBeenCalledWith("9341457665739480");
  });

  it("shows when the connection was made and how long it stays valid, and never the access token", async () => {
    await view({ connectedAt: Date.UTC(2026, 9, 14, 12) / 1000, refreshTokenExpiresAt: Date.UTC(2027, 0, 23, 12) / 1000 });
    expect(screen.getByText(/Connected on/)).toHaveTextContent("Oct 14, 2026");
    expect(screen.getByText(/Connection valid until/)).toHaveTextContent("Jan 23, 2027");
    // The access token lives an hour and is refreshed on its own; showing its
    // expiry would only invite alarm over a number nobody acts on.
    expect(screen.queryByText(/access token/i)).not.toBeInTheDocument();
  });

  it("carries the sync status area and the three counts", async () => {
    await view({ openErrors: [failedRow] });
    expect(screen.getByRole("switch", { name: "Automatic sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getAllByText("Contacts matched").length).toBeGreaterThan(0);
    expect(screen.getByText("Invoices synced")).toBeInTheDocument();
    expect(screen.getByText(/Need attention · review below/)).toBeInTheDocument();
  });
});

describe("QboConnectionPanel - Disconnect", () => {
  it("is a quiet text button, titled the way Intuit requires, with no solid red fill", async () => {
    await view();
    const btn = screen.getByRole("button", { name: "Disconnect from QuickBooks" });
    expect(btn.className).not.toMatch(/(^|\s)bg-ih-bad(\s|$)/);
    expect(btn.className).not.toMatch(/(^|\s)bg-ih-bad-fg(\s|$)/);
    expect(btn.className).toContain("bg-transparent");
  });

  it("only asks to open the confirmation; the panel never disconnects by itself", async () => {
    const v = await view();
    act(() => { screen.getByRole("button", { name: "Disconnect from QuickBooks" }).click(); });
    expect(v.props.onRequestDisconnect).toHaveBeenCalledTimes(1);
    expect(v.props.onSync).not.toHaveBeenCalled();
    expect(v.props.onToggleAuto).not.toHaveBeenCalled();
  });

  it("puts every control to sleep together while any action runs, and none when idle", async () => {
    await view({}, { busy: true });
    for (const control of [
      screen.getByRole("button", { name: "Sync now" }),
      screen.getByRole("switch", { name: "Automatic sync" }),
      screen.getByRole("button", { name: "Disconnect from QuickBooks" }),
    ]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
    }
    cleanup();
    await view({}, { busy: false });
    for (const control of [
      screen.getByRole("button", { name: "Sync now" }),
      screen.getByRole("switch", { name: "Automatic sync" }),
      screen.getByRole("button", { name: "Disconnect from QuickBooks" }),
    ]) {
      expect(control).not.toHaveAttribute("aria-disabled");
    }
  });

  it("is inert while another action runs", async () => {
    const v = await view({}, { busy: true });
    act(() => { screen.getByRole("button", { name: "Disconnect from QuickBooks" }).click(); });
    expect(v.props.onRequestDisconnect).not.toHaveBeenCalled();
  });
});

describe("QboConnectionPanel - expiry warning and the way back in", () => {
  const link = () => screen.queryByRole("link", { name: /reconnect/i });

  it("warns inside the 30-day window and links to the OAuth start", async () => {
    await view({ refreshTokenExpiresAt: NOW + 29 * DAY });
    expect(screen.getByText(/connection expires soon/i)).toBeInTheDocument();
    expect(link()).toHaveAttribute("href", "/api/integrations/qbo/connect");
  });

  it("says it has expired, and still offers the reconnect link, once the date has passed", async () => {
    await view({ refreshTokenExpiresAt: NOW - DAY });
    expect(screen.getByText(/connection has expired/i)).toBeInTheDocument();
    expect(link()).toHaveAttribute("href", "/api/integrations/qbo/connect");
  });

  it("shows no warning and no reconnect link outside the window (control)", async () => {
    await view({ refreshTokenExpiresAt: NOW + 31 * DAY });
    expect(screen.queryByText(/expires soon|has expired/i)).not.toBeInTheDocument();
    expect(link()).toBeNull();
  });
});

describe("QboConnectionPanel - below the card", () => {
  it("lists the items that need attention with their dismiss buttons", async () => {
    await view({ openErrors: [failedRow] });
    expect(screen.getByRole("heading", { name: "1 item needs attention" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("shows payment discrepancies and held deposits from the status", async () => {
    await view({
      paymentDiscrepancies: [{ id: "d", invoiceId: "abcdef0123", currency: "USD", ledgerCents: 500, qboCents: 400 }],
      heldDepositCount: 2,
    });
    expect(screen.getByText(/Payment discrepancies \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Not sent to QuickBooks")).toBeInTheDocument();
  });

  it("has a contact matching card with the matched count", async () => {
    await view({ mappedCustomers: 41 });
    expect(screen.getByRole("heading", { name: "Contact matching" })).toBeInTheDocument();
    expect(screen.getByText("Matched to a QuickBooks customer").previousSibling).toHaveTextContent("41");
  });
});
