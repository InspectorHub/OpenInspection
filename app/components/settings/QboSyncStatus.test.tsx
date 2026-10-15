// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QboSyncStatus } from "./QboSyncStatus";

afterEach(cleanup);

const NOW = Math.floor(Date.now() / 1000);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function view(over: Partial<React.ComponentProps<typeof QboSyncStatus>> = {}) {
  const props = {
    lastSyncAt: NOW - 12 * 60,
    openErrorCount: 0,
    syncEnabled: true,
    syncing: false,
    busy: false,
    mappedCustomers: 41,
    mappedInvoices: 96,
    onSync: vi.fn(),
    onToggleAuto: vi.fn(),
    ...over,
  };
  const utils = render(<QboSyncStatus {...props} />);
  return { ...utils, props, rerender: (next: Partial<typeof props>) => utils.rerender(<QboSyncStatus {...props} {...next} />) };
}

describe("QboSyncStatus - last sync line", () => {
  it("says 'Not checked yet' before the first sync, and a relative time after it", () => {
    const first = view({ lastSyncAt: null });
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByText(/Sync now checks QuickBooks for payments\. Contacts and invoices are sent when you create or update them/)).toBeInTheDocument();
    first.unmount();

    view({ lastSyncAt: NOW - 12 * 60 });
    expect(screen.getByText(/Last checked 12 minutes ago/)).toBeInTheDocument();
    expect(screen.queryByText("Not checked yet")).not.toBeInTheDocument();
  });

  it("steps through just now, minutes, hours and days", () => {
    const text = (secondsAgo: number) => {
      const v = view({ lastSyncAt: NOW - secondsAgo });
      const t = screen.getByText(/Last checked/).textContent;
      v.unmount();
      return t;
    };
    expect(text(20)).toBe("Last checked Just now");
    expect(text(5 * 60)).toBe("Last checked 5 minutes ago");
    expect(text(3 * 3600)).toBe("Last checked 3 hours ago");
    expect(text(48 * 3600)).toBe("Last checked 2 days ago");
  });

  it("counts days once the gap passes a day", () => {
    view({ lastSyncAt: NOW - 3 * 24 * 3600 });
    expect(screen.getByText(/Last checked 3 days ago/)).toBeInTheDocument();
  });

  it("links the attention count to the health section, and omits it when there is none", () => {
    const withItems = view({ openErrorCount: 2 });
    const links = screen.getAllByRole("link", { name: /2 items need attention/i });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute("href", "#health");
    withItems.unmount();

    view({ openErrorCount: 0 });
    expect(document.querySelector('a[href="#health"]')).toBeNull();
    expect(screen.queryByText(/items? needs? attention/i)).not.toBeInTheDocument();
  });

  it("uses the singular for exactly one item", () => {
    view({ openErrorCount: 1 });
    expect(screen.getAllByText(/1 item needs attention/).length).toBeGreaterThan(0);
  });
});

describe("QboSyncStatus - counts", () => {
  it("shows the matched contacts and synced invoices", () => {
    view({ mappedCustomers: 41, mappedInvoices: 96 });
    expect(screen.getByText("41").nextSibling).toHaveTextContent("Contacts matched");
    expect(screen.getByText("96").nextSibling).toHaveTextContent("Invoices synced");
  });
});

describe("QboSyncStatus - Automatic sync switch", () => {
  it("reflects the prop and does not flip optimistically", async () => {
    const v = view({ syncEnabled: true });
    const sw = screen.getByRole("switch", { name: "Automatic sync" });
    expect(sw).toHaveAttribute("aria-checked", "true");

    act(() => { sw.click(); });
    await settle();
    // The parent has not answered yet: the visual state is still the prop's.
    expect(v.props.onToggleAuto).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: "Automatic sync" })).toHaveAttribute("aria-checked", "true");

    v.rerender({ syncEnabled: false });
    expect(screen.getByRole("switch", { name: "Automatic sync" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Automatic sync is off.")).toBeInTheDocument();
  });

  it("sends one request for two clicks in the same frame, and works again afterwards", async () => {
    const v = view();
    const sw = screen.getByRole("switch", { name: "Automatic sync" });
    act(() => { sw.click(); sw.click(); });
    expect(v.props.onToggleAuto).toHaveBeenCalledTimes(1);

    await settle();
    act(() => { sw.click(); });
    expect(v.props.onToggleAuto).toHaveBeenCalledTimes(2);
  });

  it("is inert while a request is in flight", () => {
    const v = view({ busy: true });
    const sw = screen.getByRole("switch", { name: "Automatic sync" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    act(() => { sw.click(); });
    expect(v.props.onToggleAuto).not.toHaveBeenCalled();
  });
});

describe("QboSyncStatus - Sync now", () => {
  it("calls onSync once for two same-frame clicks, and again once settled", async () => {
    const v = view();
    const btn = screen.getByRole("button", { name: "Sync now" });
    act(() => { btn.click(); btn.click(); });
    expect(v.props.onSync).toHaveBeenCalledTimes(1);

    await settle();
    act(() => { btn.click(); });
    expect(v.props.onSync).toHaveBeenCalledTimes(2);
  });

  it("shows progress and ignores clicks while syncing", () => {
    const v = view({ syncing: true, busy: true });
    const btn = screen.getByRole("button", { name: "Syncing..." });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute("aria-busy", "true");
    act(() => { btn.click(); });
    expect(v.props.onSync).not.toHaveBeenCalled();
  });

  it("is disabled, but not labelled as syncing, while some other action runs", () => {
    view({ syncing: false, busy: true });
    const btn = screen.getByRole("button", { name: "Sync now" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toHaveAttribute("aria-busy");
  });
});
