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
import { render } from "@testing-library/react";
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

  it("links a row to the inspection it bills", async () => {
    const { findAllByRole } = renderInvoices([UNPAID]);
    const toInspection = (await findAllByRole("link")).filter(
      (a) => a.getAttribute("href") === "/inspections/insp-xyz",
    );
    expect(toInspection.length).toBeGreaterThan(0);
    expect(toInspection[0].textContent).toContain("Sam Okafor");
  });

  it("gives a PAID row an action instead of a bare dash", async () => {
    const { findAllByRole, container } = renderInvoices([BILLED]);
    const view = (await findAllByRole("link")).filter((a) => a.textContent === "View inspection");

    expect(view.length).toBe(1);
    expect(view[0].getAttribute("href")).toBe("/inspections/insp-abc");
    // The dash is what the cell used to be; it must be gone for this row.
    expect(container.querySelector("tbody")?.textContent).not.toContain("—");
  });

  it("renders an inspection-less invoice as plain text, not a broken link", async () => {
    const { findByRole, queryAllByRole, container } = renderInvoices([STANDALONE]);
    await findByRole("heading", { name: "Invoices" });

    expect(queryAllByRole("link")).toHaveLength(0);
    expect(container.textContent).toContain("Ali Haddad");
    // With nowhere to go, the dash is honest — keep it.
    expect(container.querySelector("tbody")?.textContent).toContain("—");
  });
});
