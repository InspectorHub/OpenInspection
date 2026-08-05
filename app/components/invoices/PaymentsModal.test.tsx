// @vitest-environment happy-dom
/**
 * The staff payment surface.
 *
 * The one thing worth a test here is the thing the plan says will be
 * "simplified" away: the DATE. It is visible, editable, pre-filled with today
 * rather than assumed to be today, and what gets submitted for a past date is
 * that past day — not the moment the form was posted. A surface that quietly
 * stamped now() would pass every other assertion on this page.
 *
 * The balance is the second: it is derived from the ROWS against the invoice
 * total, refunds subtracting, so a correction moves it without anything reading
 * the cached column.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PaymentsModal, type PaymentRow } from "./PaymentsModal";

const INVOICE = { id: "inv-1", clientName: "Dana Reyes", amountCents: 45000, currency: "USD" };

const CASH: PaymentRow = {
    id: "pay-1", kind: "balance", amountCents: 20000, method: "cash", provider: null,
    note: "at the door", occurredAt: "2026-03-03T09:00:00.000Z",
    recordedBy: "u-1", recordedByName: "Dana Reyes", refundsId: null,
};

const CORRECTION: PaymentRow = {
    id: "pay-2", kind: "refund", amountCents: 18000, method: "cash", provider: null,
    note: "Correction: decimal typo", occurredAt: "2026-03-03T09:00:00.000Z",
    recordedBy: "u-1", recordedByName: "Dana Reyes", refundsId: "pay-1",
};

function mockFetcher(data?: unknown) {
    return { state: "idle" as const, data, submit: vi.fn(), load: vi.fn(), Form: () => null };
}

function renderModal(payments: PaymentRow[], fetcher = mockFetcher()) {
    const utils = render(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <PaymentsModal invoice={INVOICE} payments={payments} loading={false} fetcher={fetcher as any} locale="en-US" onClose={() => {}} />,
    );
    return { ...utils, fetcher };
}

/** The browser's own calendar day, the same way the component computes it. */
function todayLocal(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

describe("PaymentsModal — the date", () => {
    it("shows the date field, pre-filled with today and editable", () => {
        const { container } = renderModal([]);
        const date = container.querySelector('input[type="date"]') as HTMLInputElement;
        expect(date).toBeTruthy();
        expect(date.value).toBe(todayLocal());
        expect(date.disabled).toBe(false);
        expect(date.readOnly).toBe(false);
    });

    it("submits the day the money moved, not the moment the form was posted", () => {
        // Tuesday's cash, recorded today. If the surface defaulted to now(), the
        // submitted instant would land on today's date and this would fail.
        const { container, getByText, fetcher } = renderModal([]);
        fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: "200" } });
        fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2026-03-03" } });
        fireEvent.click(getByText("Record payment"));

        expect(fetcher.submit).toHaveBeenCalledTimes(1);
        const sent = fetcher.submit.mock.calls[0][0] as Record<string, string>;
        expect(sent.intent).toBe("record-payment");
        expect(sent.amount).toBe("200");
        // A full instant on the wire, and it is Tuesday's — in the browser's own
        // zone, which is the only place that mapping can honestly be made.
        const submitted = new Date(sent.occurredAt);
        expect(Number.isNaN(submitted.getTime())).toBe(false);
        expect(submitted.getFullYear()).toBe(2026);
        expect(submitted.getMonth()).toBe(2);
        expect(submitted.getDate()).toBe(3);
        // …and emphatically not today's, which is what a defaulted field would send.
        expect(`${submitted.getFullYear()}-03-03`).not.toBe(todayLocal());
    });

    it("will not offer a future day to pick", () => {
        const { container } = renderModal([]);
        const date = container.querySelector('input[type="date"]') as HTMLInputElement;
        expect(date.getAttribute("max")).toBe(todayLocal());
    });
});

describe("PaymentsModal — the ledger and the balance", () => {
    it("makes the remaining balance the prominent figure", () => {
        const { container } = renderModal([CASH]);
        expect(container.textContent).toContain("$250.00");   // 45000 − 20000 remaining
        expect(container.textContent).toContain("$450.00");   // invoice total, secondary
        expect(container.textContent).toContain("$200.00");   // received
    });

    it("subtracts a correction from the balance without reading a cached total", () => {
        const { container } = renderModal([CASH, CORRECTION]);
        // 20000 received, 18000 corrected away → 2000 net, 43000 still owed.
        expect(container.textContent).toContain("$430.00");
        expect(container.textContent).toContain("$20.00");
    });

    it("keeps the original visible with the correction below it", () => {
        const { container } = renderModal([CASH, CORRECTION]);
        const items = [...container.querySelectorAll("li")];
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain("$200.00");
        expect(items[0].textContent).toContain("at the door");
        expect(items[1].textContent).toContain("$180.00");
        expect(items[1].textContent).toContain("decimal typo");
    });

    it("names who recorded each row — the question a dispute turns on", () => {
        const { container } = renderModal([CASH]);
        expect(container.textContent).toContain("Recorded by Dana Reyes");
        expect(container.textContent).toContain("Cash");
    });

    it("offers the correction control on exactly the row that can take one", () => {
        // Not on a correction (it reverses, it is not reversed), not on a
        // provider row (that money is reconciled elsewhere), and not on a row
        // that already carries a correction — that click would only earn a 409.
        const provider: PaymentRow = { ...CASH, id: "pay-3", provider: "stripe", method: "card", recordedByName: null };
        const cheque: PaymentRow = { ...CASH, id: "pay-4", amountCents: 10000, method: "check", note: "Cheque 4471" };

        const corrected = renderModal([CASH, CORRECTION, provider]);
        expect([...corrected.container.querySelectorAll("button")].filter((b) => b.textContent === "Correct")).toHaveLength(0);

        const open = renderModal([CASH, CORRECTION, provider, cheque]);
        const controls = [...open.container.querySelectorAll("li")]
            .filter((li) => [...li.querySelectorAll("button")].some((b) => b.textContent === "Correct"));
        expect(controls).toHaveLength(1);
        expect(controls[0].textContent).toContain("Cheque 4471");
    });

    it("says so plainly when nothing has been recorded", () => {
        const { container } = renderModal([]);
        expect(container.textContent).toContain("No payments recorded yet.");
    });
});

describe("PaymentsModal — overpayment", () => {
    it("offers a deliberate confirm only after the endpoint refuses one", () => {
        const clean = renderModal([]);
        expect([...clean.container.querySelectorAll("button")].some((b) => b.textContent === "Record it anyway")).toBe(false);

        const refused = renderModal([], mockFetcher({
            intent: "record-payment", ok: false,
            error: "This payment exceeds the outstanding balance on this invoice (25000 cents remaining).",
        }));
        const anyway = [...refused.container.querySelectorAll("button")].find((b) => b.textContent === "Record it anyway");
        expect(anyway).toBeTruthy();

        fireEvent.click(anyway!);
        const sent = refused.fetcher.submit.mock.calls[0][0] as Record<string, string>;
        expect(sent.allowOverpayment).toBe("1");
    });
});
