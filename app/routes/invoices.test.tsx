// @vitest-environment happy-dom
/**
 * IA-97 — the invoices list was a dead end. Three defects, one page:
 *
 *  1. The heading and its meta line rendered the same sentence twice
 *     ("2 Invoices" over "2 invoices").
 *  2. Nothing linked an invoice to the inspection it bills.
 *  3. A PAID row's Action cell was a bare "—", which reads as a broken
 *     feature rather than a settled account. That is the one a user
 *     actually reported.
 *
 * Note `createRoutesStub` does NOT run middleware — see the repo note on it —
 * so these assert rendering only. That is the whole scope here: every defect
 * above is a rendering defect, and there is no auth decision to get wrong.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import InvoicesPage from "~/routes/invoices";

const BILLED = {
  id: "inv-1",
  clientName: "Dana Reyes",
  amountCents: 45000,
  dueDate: "2026-08-01",
  status: "paid" as const,
  paymentMethod: "check" as const,
  inspectionId: "insp-abc",
  currency: "USD",
};

const UNPAID = { ...BILLED, id: "inv-2", clientName: "Sam Okafor", status: "sent" as const, paymentMethod: null, inspectionId: "insp-xyz" };

/** An invoice raised without an inspection — nothing to navigate to. */
const STANDALONE = { ...BILLED, id: "inv-3", clientName: "Ali Haddad", inspectionId: null };

function renderInvoices(invoices: unknown[]) {
  const Stub = createRoutesStub([
    { path: "/invoices", Component: InvoicesPage, loader: () => ({ invoices, inspections: [] }) },
  ]);
  return render(<Stub initialEntries={["/invoices"]} />);
}

describe("/invoices — IA-97", () => {
  it("does not print the same count in both the heading and its meta line", async () => {
    const { container, findByRole } = renderInvoices([BILLED, UNPAID]);
    const heading = await findByRole("heading", { name: "Invoices" });
    const header = heading.closest("header") ?? container;

    expect(heading.textContent).toBe("Invoices");
    // The meta line carries the numbers, and says something the heading does not.
    expect(header.textContent).toContain("2 invoices");
    expect(header.textContent).toContain("1 unpaid");
  });

  it("omits the unpaid clause when nothing is outstanding", async () => {
    const { container, findByRole } = renderInvoices([BILLED]);
    await findByRole("heading", { name: "Invoices" });
    expect(container.textContent).not.toContain("0 unpaid");
  });

  it("gives an UNPAID row exactly one labelled route to its inspection", async () => {
    // IA-122 — this used to assert that the CLIENT NAME was the link, styled
    // only on hover. Three rows offered the same destination three ways: an
    // unpaid row had nothing but that invisible name link, a paid row had the
    // name link AND a button with the identical href, and a standalone invoice
    // had a bare dash. The row that needed chasing was the hardest to act on,
    // and a person's name is the wrong label for "open the inspection" anyway.
    const { findAllByRole } = renderInvoices([UNPAID]);
    const toInspection = (await findAllByRole("link")).filter(
      (a) => a.getAttribute("href") === "/inspections/insp-xyz",
    );

    expect(toInspection).toHaveLength(1);
    expect(toInspection[0].textContent).toBe("View inspection");
    // …and the name is no longer a disguised control.
    expect(toInspection[0].textContent).not.toContain("Sam Okafor");
  });

  it("gives a PAID row an action instead of a bare dash", async () => {
    const { findAllByRole, container } = renderInvoices([BILLED]);
    const view = (await findAllByRole("link")).filter((a) => a.textContent === "View inspection");

    expect(view.length).toBe(1);
    expect(view[0].getAttribute("href")).toBe("/inspections/insp-abc");
    // The dash is what the cell used to be; it must be gone for this row.
    expect(container.querySelector("tbody")?.textContent).not.toContain("—");
  });

  it("shows a failed mark-paid instead of swallowing it", async () => {
    // The regression: POST mark-paid returned 400, the action discarded the
    // reason, and nothing rendered. The picker closed, the pill stayed SENT,
    // and an operator who had just banked a cheque had no signal at all that
    // it went unrecorded — the worst outcome for the one action on this page
    // that moves money in their books.
    const Stub = createRoutesStub([
      {
        path: "/invoices",
        Component: InvoicesPage,
        loader: () => ({ invoices: [UNPAID], inspections: [] }),
        action: () => ({ intent: "mark-paid", ok: false, error: "Invoice not found" }),
      },
    ]);
    const { findByText, findAllByRole } = render(<Stub initialEntries={["/invoices"]} />);

    const markPaid = (await findAllByRole("button")).find((b) => b.textContent === "Mark paid");
    if (!markPaid) throw new Error("no Mark paid button");
    fireEvent.click(markPaid);

    const check = (await findAllByRole("button")).find((b) => b.textContent === "Check");
    if (!check) throw new Error("no method picker");
    fireEvent.click(check);

    expect(await findByText("Invoice not found")).toBeTruthy();
  });

  it("stays quiet when mark-paid succeeds", async () => {
    // An always-on banner would be its own defect.
    const Stub = createRoutesStub([
      {
        path: "/invoices",
        Component: InvoicesPage,
        loader: () => ({ invoices: [UNPAID], inspections: [] }),
        action: () => ({ intent: "mark-paid", ok: true, error: null }),
      },
    ]);
    const { findAllByRole, queryByRole } = render(<Stub initialEntries={["/invoices"]} />);

    const markPaid = (await findAllByRole("button")).find((b) => b.textContent === "Mark paid");
    if (!markPaid) throw new Error("no Mark paid button");
    fireEvent.click(markPaid);
    const check = (await findAllByRole("button")).find((b) => b.textContent === "Check");
    if (!check) throw new Error("no method picker");
    fireEvent.click(check);

    expect(queryByRole("alert")).toBeNull();
  });

  it("does not call a cash figure REVENUE, and does not omit a partial payment (F28)", async () => {
    // TWO pages said "REVENUE" and the two numbers disagreed: /metrics totals
    // what was BILLED, this card totals what was RECEIVED, and nothing on
    // either page said so. Revenue is the billed figure, so /metrics keeps the
    // word and this card names the cash.
    //
    // The card also has to BE the cash. It used to sum the full amount of
    // invoices whose status was `paid`, so $200 banked against a $450 invoice —
    // status `partial` — counted as nothing at all.
    const { findByText, container } = renderInvoices([
      // Paid in full, $450 in.
      { ...BILLED, amountPaidCents: 45000 },
      // $200 of $450 in. The money that used to vanish from this card.
      { ...UNPAID, id: "inv-p", status: "partial" as const, amountPaidCents: 20000 },
      // Voided: never counts, whatever it once carried.
      { ...BILLED, id: "inv-v", status: "void" as const, amountPaidCents: 45000 },
      // A pre-ledger row marked paid with no recorded figure: its total IS what
      // came in, and reading the null as zero would erase a real payment.
      { ...BILLED, id: "inv-legacy", amountPaidCents: null },
    ]);

    const label = await findByText("COLLECTED");
    // The word this page must NOT use for cash.
    expect(container.textContent).not.toContain("REVENUE");
    // $450 + $200 + $450 = $1,100. The void invoice's $450 is excluded.
    expect(label.parentElement?.textContent).toContain("$1,100");
  });

  it("does not promise that Mark paid unlocks the report (F49)", async () => {
    // The footer said so unconditionally. The gate is `inspections.paymentRequired`,
    // `notNull().default(false)`, set only at publish time by an explicit
    // `requirePayment` — so for a tenant who never checks that box, the promised
    // effect never happens once.
    const { container, findByRole } = renderInvoices([BILLED]);
    await findByRole("heading", { name: "Invoices" });
    const text = container.textContent ?? "";

    expect(text).toContain("Mark paid");
    // The unconditional claim, verbatim as it shipped.
    expect(text).not.toContain("and unlocks the report");
    // Replaced by a conditional one that names the condition.
    expect(text).toContain("published with payment required");
  });

  it("spells the payment method one way (F49)", async () => {
    // The method dropdown said American "Check" while the note placeholder
    // beside it said British "Cheque" — same modal, same thing, two spellings.
    const { findAllByRole, container } = renderInvoices([UNPAID]);
    const payments = (await findAllByRole("button")).find((b) => b.textContent === "Payments");
    if (!payments) throw new Error("no Payments button");
    fireEvent.click(payments);

    const placeholders = Array.from(container.querySelectorAll("input"))
      .map((el) => el.getAttribute("placeholder") ?? "")
      .join(" ");
    // Proves the modal is actually open, so the absence below is an absence of
    // the WORD and not an absence of the field.
    expect(placeholders).toContain("number, reference");
    expect(placeholders).not.toContain("Cheque");
    expect(placeholders).toContain("Check number");
  });

  it("still offers a standalone invoice something to do (IA-123)", async () => {
    // This used to assert the opposite — "with nowhere to go, the dash is
    // honest, keep it". It was not honest, it was a dead end: an invoice with
    // no inspection could be marked paid once and then had no verb at all. Not
    // openable, not correctable. Void was the missing one, and it already
    // existed on the server: DELETE /api/invoices/{id} voids rather than
    // deletes ("the row is preserved for the audit trail") and had no caller
    // anywhere in the app, so an invoice raised in error simply stood.
    const { findByRole, queryAllByRole, findAllByRole, container } = renderInvoices([STANDALONE]);
    await findByRole("heading", { name: "Invoices" });

    // No inspection means no link — that part was always right.
    expect(queryAllByRole("link")).toHaveLength(0);
    expect(container.textContent).toContain("Ali Haddad");

    const voidBtn = (await findAllByRole("button")).filter((b) => b.textContent === "Void");
    expect(voidBtn).toHaveLength(1);
  });
});
