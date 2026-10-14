// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import { QboDisconnectDialog } from "./QboDisconnectDialog";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function view(over: Partial<React.ComponentProps<typeof QboDisconnectDialog>> = {}) {
  const props = {
    open: true,
    companyName: "Whitfield Home Inspections LLC",
    mappedCustomers: 41,
    mappedInvoices: 96,
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  return { ...render(<QboDisconnectDialog {...props} />), props };
}

describe("QboDisconnectDialog", () => {
  it("is titled the way Intuit requires and names the company", () => {
    view();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Disconnect from QuickBooks?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Whitfield Home Inspections LLC");
  });

  it("states everything the disconnect removes, including what the old copy left out", () => {
    view();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Invoices and payments stop syncing.");
    expect(dialog).toHaveTextContent("41 contacts and 96 invoices");
    // retireConnection also deletes the open sync errors and resets every invoice's sync state.
    expect(dialog).toHaveTextContent(/Every item that needs attention is removed/);
    expect(dialog).toHaveTextContent(/sync state of every invoice is reset/);
  });

  it("warns what the first sync after a reconnect will do", () => {
    view();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/matches contacts to customers by email/);
    expect(dialog).toHaveTextContent(/creates a new customer in QuickBooks/);
  });

  it("falls back to a generic phrase when QuickBooks never gave a company name", () => {
    view({ companyName: null });
    expect(screen.getByRole("dialog")).toHaveTextContent("your QuickBooks company");
  });

  it("renders nothing while closed (control)", () => {
    view({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not confirm on cancel, and confirms on the destructive button", () => {
    const v = view();
    const dialog = screen.getByRole("dialog");
    act(() => { within(dialog).getByRole("button", { name: "Keep connected" }).click(); });
    expect(v.props.onCancel).toHaveBeenCalledTimes(1);
    expect(v.props.onConfirm).not.toHaveBeenCalled();

    act(() => { within(dialog).getByRole("button", { name: "Disconnect from QuickBooks" }).click(); });
    expect(v.props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirms once for two clicks in the same frame, and works again afterwards", async () => {
    const v = view();
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect from QuickBooks" });
    act(() => { confirm.click(); confirm.click(); });
    expect(v.props.onConfirm).toHaveBeenCalledTimes(1);

    await settle();
    act(() => { confirm.click(); });
    expect(v.props.onConfirm).toHaveBeenCalledTimes(2);
  });
});
