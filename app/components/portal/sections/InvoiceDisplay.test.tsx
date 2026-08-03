// @vitest-environment happy-dom
/**
 * IA-89 — what a client sees in the seconds between paying and the webhook
 * settling the invoice.
 *
 * Stripe redirects back to the Hub with `?redirect_status=succeeded` while the
 * invoice row still says `sent`. That window used to render the UNPAID layout —
 * a `SENT` badge and "BALANCE DUE $450" in the largest type on the page — with a
 * small green "Payment received" note underneath. The three signals contradicted
 * each other, and the loudest one told a client who had just been charged that
 * they still owed the money.
 *
 * These assertions pin the fix: the optimistic window renders the PAID layout
 * with its wording swapped, so the only change the client sees when the webhook
 * lands is "Processing" → "Paid".
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { InvoiceDisplay } from "./InvoiceDisplay";
import type { InvoiceData } from "./payment-helpers";
import type { TenantBrand } from "~/lib/brand";

const BRAND = { companyName: "Acme Inspections", primaryColor: "#2563eb" } as TenantBrand;

const UNPAID: InvoiceData = {
  number: "INV-1042",
  date: "2026-07-26",
  dueDate: null,
  status: "sent",
  clientName: "Dana Client",
  inspectorName: "Sam Inspector",
  lineItems: [{ description: "Home inspection", amount: 450 }],
  total: 450,
};

/**
 * Rendered inside a data router because the unpaid branch mounts
 * <StripePayPanel>, which reads the session context off the route loader data.
 */
function renderInvoice(invoice: InvoiceData, justPaid: boolean) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <InvoiceDisplay invoice={invoice} brand={BRAND} inspectionId="insp-1" portalToken="tok" justPaid={justPaid} />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("InvoiceDisplay optimistic post-payment state", () => {
  it("never shows a balance due after a successful redirect", () => {
    const { queryByText, getByText } = renderInvoice(UNPAID, true);

    // The contradiction, stated as an assertion: the loudest element must not
    // be asking for money that was just paid.
    expect(queryByText("Balance due")).toBeNull();
    expect(getByText("Balance")).toBeTruthy();
    expect(getByText("Finalizing receipt")).toBeTruthy();
  });

  it("credits the payment in the totals block, as the paid layout does", () => {
    const { getByText } = renderInvoice(UNPAID, true);
    expect(getByText("Amount paid")).toBeTruthy();
    expect(getByText("−$450")).toBeTruthy();
  });

  it("replaces the SENT badge and stamps the document Processing", () => {
    const { queryByText, getByText } = renderInvoice(UNPAID, true);
    expect(queryByText("sent")).toBeNull();
    expect(getByText("processing")).toBeTruthy();
    expect(getByText("Processing")).toBeTruthy();
    expect(queryByText("Paid")).toBeNull();
  });

  it("hides the pay form so the client cannot pay twice", () => {
    const { queryByText } = renderInvoice(UNPAID, true);
    expect(queryByText(/Pay this invoice/i)).toBeNull();
  });

  it("still renders the unpaid layout before the redirect", () => {
    const { getByText, queryByText } = renderInvoice(UNPAID, false);
    expect(getByText("Balance due")).toBeTruthy();
    expect(getByText("sent")).toBeTruthy();
    expect(queryByText("Finalizing receipt")).toBeNull();
    expect(queryByText("Amount paid")).toBeNull();
  });

  it("settles into the paid layout once the invoice says paid", () => {
    const { getByText, queryByText } = renderInvoice({ ...UNPAID, status: "paid" }, false);
    expect(getByText("Paid")).toBeTruthy();
    expect(getByText("Amount paid")).toBeTruthy();
    expect(getByText("$0")).toBeTruthy();
    expect(queryByText("Finalizing receipt")).toBeNull();
  });
});
