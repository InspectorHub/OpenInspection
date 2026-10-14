// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoutesStub } from "react-router";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import { QboBooksHealth } from "./QboBooksHealth";
import { QBO_VOIDED_IN_QBO } from "../../../server/lib/qbo-discrepancy";
import type { QBOSyncErrorSummary } from "../../../server/services/qbo/api-base";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function row(over: Partial<QBOSyncErrorSummary> = {}): QBOSyncErrorSummary {
  return {
    id: "e1", oiType: "invoice", oiId: "0123456789abcdef", errorCode: "SYNC_ERROR",
    message: "QuickBooks said no", retries: 1, lastSeenAt: 1, ...over,
  };
}

async function view(over: Partial<React.ComponentProps<typeof QboBooksHealth>> = {}) {
  const props = {
    openErrors: [row()],
    discrepancies: [],
    heldDepositCount: 0,
    onDismissError: vi.fn(),
    onMatchContact: vi.fn(),
    dismissingId: null as string | null,
    ...over,
  };
  const Stub = createRoutesStub([{ path: "/", Component: () => <QboBooksHealth {...props} /> }]);
  let utils!: ReturnType<typeof render>;
  await act(async () => { utils = render(<Stub initialEntries={["/"]} />); });
  return { ...utils, props };
}

describe("QboBooksHealth - items that need attention", () => {
  it("heads the card with the count and is the target of the #health anchor", async () => {
    const { container } = await view({ openErrors: [row(), row({ id: "e2" })] });
    expect(screen.getByRole("heading", { name: "2 items need attention" })).toBeInTheDocument();
    expect(container.querySelector("#health")).not.toBeNull();
  });

  it("renders nothing for the card when there are no items (control)", async () => {
    const { container } = await view({ openErrors: [] });
    expect(screen.queryByRole("heading", { name: /need attention/i })).not.toBeInTheDocument();
    expect(container.querySelector("#health")).toBeNull();
  });

  it("tells the three kinds of row apart, and still shows an unknown code", async () => {
    await view({
      openErrors: [
        row({ id: "a", errorCode: QBO_VOIDED_IN_QBO }),
        row({ id: "b", errorCode: "SYNC_ERROR" }),
        row({ id: "c", errorCode: "SOMETHING_NEW" }),
      ],
    });
    expect(screen.getByText("Voided in QuickBooks")).toBeInTheDocument();
    expect(screen.getByText("Failed to send")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("shows the entity truncated to eight characters and never as a link", async () => {
    const { container } = await view({ openErrors: [row({ oiType: "invoice", oiId: "0123456789abcdef" })] });
    expect(screen.getByText(/invoice 01234567/)).toBeInTheDocument();
    expect(screen.queryByText(/0123456789abcdef/)).not.toBeInTheDocument();
    expect(container.querySelector("li a")).toBeNull();
  });

  it("tolerates the 'bootstrap' sentinel id", async () => {
    const { container } = await view({ openErrors: [row({ oiType: "contact", oiId: "bootstrap" })] });
    // The sentinel is a word, not an id: cutting it to eight characters reads as
    // a typo ("bootstra"). It is shown whole, and still just text.
    expect(screen.getByText(/contact bootstrap ·/)).toBeInTheDocument();
    expect(container.querySelector("li a")).toBeNull();
  });

  it("says 'Seen once' for a first detection and 'Seen N times' for a repeat", async () => {
    await view({ openErrors: [row({ id: "a", retries: 1 }), row({ id: "b", retries: 4 })] });
    expect(screen.getByText(/Seen once/)).toBeInTheDocument();
    expect(screen.getByText(/Seen 4 times/)).toBeInTheDocument();
  });

  it("shows what QuickBooks actually said", async () => {
    await view({ openErrors: [row({ message: "Duplicate name exists" })] });
    expect(screen.getByText("Duplicate name exists")).toBeInTheDocument();
  });
});

describe("QboBooksHealth - Dismiss", () => {
  it("reports the id of the row it sits on", async () => {
    const v = await view({ openErrors: [row({ id: "e9" })] });
    act(() => { screen.getByRole("button", { name: "Dismiss" }).click(); });
    expect(v.props.onDismissError).toHaveBeenCalledWith("e9");
  });

  it("dismisses once for two clicks in the same frame, and again afterwards", async () => {
    const v = await view();
    const btn = screen.getByRole("button", { name: "Dismiss" });
    act(() => { btn.click(); btn.click(); });
    expect(v.props.onDismissError).toHaveBeenCalledTimes(1);

    await settle();
    act(() => { btn.click(); });
    expect(v.props.onDismissError).toHaveBeenCalledTimes(2);
  });

  it("marks only the row being closed as busy, and keeps the others inert but not busy", async () => {
    const v = await view({ openErrors: [row({ id: "a" }), row({ id: "b" })], dismissingId: "b" });
    const items = screen.getAllByRole("listitem");
    const [first, second] = items.map((li) => within(li).getByRole("button", { name: "Dismiss" }));
    expect(second).toHaveAttribute("aria-busy", "true");
    expect(first).not.toHaveAttribute("aria-busy");
    expect(first).toHaveAttribute("aria-disabled", "true");
    act(() => { first.click(); });
    expect(v.props.onDismissError).not.toHaveBeenCalled();
  });

  it("is usable again once nothing is being dismissed (a failed dismiss recovers)", async () => {
    const v = await view({ dismissingId: null });
    const btn = screen.getByRole("button", { name: "Dismiss" });
    expect(btn).not.toHaveAttribute("aria-disabled");
    act(() => { btn.click(); });
    expect(v.props.onDismissError).toHaveBeenCalledTimes(1);
  });
});

describe("QboBooksHealth - payment discrepancies and held deposits", () => {
  it("shows both figures, never one reconciled number", async () => {
    await view({
      openErrors: [],
      discrepancies: [{ id: "d1", invoiceId: "abcdef0123456789", currency: "USD", ledgerCents: 12000, qboCents: 10000 }],
    });
    expect(screen.getByRole("heading", { name: "Payment discrepancies (1)" })).toBeInTheDocument();
    const text = screen.getByText(/Invoice abcdef01/).textContent ?? "";
    expect(text).toContain("$120.00");
    expect(text).toContain("$100.00");
  });

  it("omits the discrepancy card when there are none (control)", async () => {
    await view({ openErrors: [], discrepancies: [] });
    expect(screen.queryByText(/Payment discrepancies/)).not.toBeInTheDocument();
  });

  it("discloses held deposits, and only when there are some", async () => {
    const v = await view({ openErrors: [], heldDepositCount: 3 });
    expect(screen.getByRole("heading", { name: "Not sent to QuickBooks" })).toBeInTheDocument();
    expect(screen.getByText(/3 payments were collected before an invoice existed/)).toBeInTheDocument();
    v.unmount();
    await view({ openErrors: [], heldDepositCount: 0 });
    expect(screen.queryByText("Not sent to QuickBooks")).not.toBeInTheDocument();
  });
});

describe("QboBooksHealth - matching a failed contact", () => {
  it("offers the match button on a contact row and passes that row to the handler", async () => {
    const contact = row({ id: "c1", oiType: "contact", oiId: "contact-1234567" });
    const { props } = await view({ openErrors: [contact] });
    const button = screen.getByRole("button", { name: "Match to a QuickBooks customer" });
    await act(async () => { button.click(); });
    expect(props.onMatchContact).toHaveBeenCalledTimes(1);
    expect(props.onMatchContact).toHaveBeenCalledWith(contact);
  });

  it("offers no match button on invoice or refund rows (control: the contact row has one)", async () => {
    await view({
      openErrors: [
        row({ id: "i1", oiType: "invoice" }),
        row({ id: "r1", oiType: "refund" }),
      ],
    });
    expect(screen.queryByRole("button", { name: "Match to a QuickBooks customer" })).not.toBeInTheDocument();
    // Control: Dismiss is still there for both, so the row actions did render.
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);

    cleanup();
    await view({ openErrors: [row({ id: "c2", oiType: "contact" })] });
    expect(screen.getAllByRole("button", { name: "Match to a QuickBooks customer" })).toHaveLength(1);
  });

  it("puts the button on only the contact rows of a mixed list", async () => {
    await view({
      openErrors: [
        row({ id: "c3", oiType: "contact" }),
        row({ id: "i3", oiType: "invoice" }),
        row({ id: "c4", oiType: "contact" }),
      ],
    });
    expect(screen.getAllByRole("button", { name: "Match to a QuickBooks customer" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(3);
  });
});
