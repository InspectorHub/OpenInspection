/**
 * <InvoiceDisplay> — the invoice document card (header · line items · totals ·
 * PAID stamp · pay-panel slot · paid confirmation), extracted from
 * <PaymentSection>. Pure presentation keyed off the mapped invoice (dollars);
 * the Stripe pay flow is delegated to <StripePayPanel>. lint:ds — only `ih-*`.
 */
import { money, STATUS_TONE, Field, Row, type InvoiceData } from "./payment-helpers";
import { StripePayPanel } from "./StripePayPanel";
import { m } from "~/paraglide/messages";
import { Pill } from "@core/shared-ui";
import { invoiceFromParty } from "~/lib/hub-blocks";
import type { TenantBrand } from "~/lib/brand";

interface InvoiceDisplayProps {
  invoice: InvoiceData;
  brand: TenantBrand;
  inspectionId: string;
  /** IA-34 — authenticates the pay-intent call (see <PaymentSection>). */
  portalToken?: string | null;
  justPaid: boolean;
}

export function InvoiceDisplay({ invoice, brand, inspectionId, portalToken, justPaid }: InvoiceDisplayProps) {
  // Derive the totals block from the available data (Subtotal · Discount · Total ·
  // Amount Paid · Balance Due). Negative line items are discounts.
  const items = invoice.lineItems ?? [];
  const charges = items.filter((i) => i.amount >= 0);
  const discounts = items.filter((i) => i.amount < 0);
  const subtotal = charges.reduce((s, i) => s + i.amount, 0);
  const discountTotal = discounts.reduce((s, i) => s + i.amount, 0); // negative
  const total = invoice.total;
  const isPaid = invoice.status === "paid";
  const isVoid = invoice.status === "void";
  const balanceDue = isPaid ? 0 : total;
  const payable = !isPaid && !isVoid && balanceDue > 0;
  // IA-89 — Stripe has redirected back but the webhook has not settled the
  // invoice yet. This is a PRESENTATION state only: nothing is written, the
  // webhook stays the settlement authority.
  const processing = payable && justPaid;
  // Everything below keys off `settled` rather than `isPaid`, so the optimistic
  // state renders the PAID layout (stamp, "Amount paid", zero balance) with its
  // wording swapped — not the unpaid layout with a reassurance box bolted on.
  // It used to render the latter: a client who had just paid $450 saw
  // "BALANCE DUE $450" in the largest type on the page, a `SENT` badge, and a
  // small green note claiming payment was received. The three signals
  // contradicted each other at the most trust-sensitive moment in the journey,
  // and the largest one was the wrong one.
  const settled = isPaid || processing;
  const amountPaid = settled ? total : 0;
  // Phase B — every amount on this document renders in the invoice's snapshot
  // currency, not the tenant's live setting. `money()` defaults to USD when absent.
  const cur = { currency: invoice.currency };

  return (
    <div className="relative bg-ih-bg-card border border-ih-border rounded-2xl shadow-ih-card overflow-hidden print:shadow-none print:border-0">
      {/* PAID stamp — "PROCESSING" until the webhook settles, so the client
          watches one element change wording rather than the page change shape. */}
      {settled && (
        <div className="pointer-events-none absolute top-16 right-6 -rotate-12 select-none">
          <span
            className={`inline-block px-4 py-1.5 rounded-md border-[3px] border-ih-ok-fg text-ih-ok-fg font-extrabold tracking-[0.25em] uppercase opacity-90 ${
              processing ? "text-base" : "text-2xl"
            }`}
          >
            {processing ? m.portal_invoice_processing_stamp() : m.portal_invoice_paid_stamp()}
          </span>
        </div>
      )}

      {/* Header band */}
      <div className="px-7 pt-7 pb-5 border-b border-ih-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">{m.portal_invoice_eyebrow()}</p>
            <h1 className="font-serif text-[26px] leading-tight font-semibold tracking-tight text-ih-fg-1 mt-0.5">
              {invoice.number}
            </h1>
          </div>
          <Pill tone={processing ? "sat" : STATUS_TONE[invoice.status] ?? "neutral"} className="shrink-0 uppercase tracking-wide">
            {processing ? m.portal_invoice_status_processing() : invoice.status}
          </Pill>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-[13px]">
          <Field label={m.portal_invoice_field_from()}>{invoiceFromParty(invoice.inspectorName, brand.companyName)}</Field>
          <Field label={m.portal_invoice_field_bill_to()}>{invoice.clientName || "—"}</Field>
          <Field label={m.portal_invoice_field_issued()}>{invoice.date || "—"}</Field>
          <Field label={m.portal_invoice_field_due()}>{invoice.dueDate || m.portal_invoice_due_on_receipt()}</Field>
        </div>
      </div>

      {/* Line items */}
      <div className="px-7 py-5">
        <div className="flex items-baseline justify-between pb-2 mb-1 border-b border-ih-border text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">
          <span>{m.portal_invoice_col_description()}</span>
          <span>{m.portal_invoice_col_amount()}</span>
        </div>
        {items.length === 0 && <p className="py-3 text-[13px] text-ih-fg-4">{m.portal_invoice_no_line_items()}</p>}
        {items.map((item, i) => (
          <div key={i} className="flex items-baseline justify-between py-2.5 border-b border-ih-border/60 last:border-b-0">
            <span className={`text-[13px] ${item.amount < 0 ? "text-ih-ok-fg" : "text-ih-fg-1"}`}>{item.description}</span>
            <span className={`text-[13px] font-mono tabular-nums ${item.amount < 0 ? "text-ih-ok-fg" : "text-ih-fg-1"}`}>
              {item.amount < 0 ? `−${money(Math.abs(item.amount), cur)}` : money(item.amount, cur)}
            </span>
          </div>
        ))}

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-ih-border space-y-1.5 text-[13px]">
          <Row label={m.portal_invoice_subtotal()} value={money(subtotal, cur)} muted />
          {discountTotal < 0 && <Row label={m.portal_invoice_discount()} value={`−${money(Math.abs(discountTotal), cur)}`} muted tone="ok" />}
          <Row label={m.portal_invoice_total()} value={money(total, cur)} strong />
          {settled && <Row label={m.portal_invoice_amount_paid()} value={`−${money(amountPaid, cur)}`} muted tone="ok" />}
          <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-ih-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">{settled ? m.portal_invoice_balance() : m.portal_invoice_balance_due()}</span>
            {processing ? (
              // The amount is deliberately absent: the balance is not zero until
              // the webhook says so, and restating "$450" here is exactly the
              // contradiction this state exists to remove.
              <span className="font-serif text-[18px] font-semibold tracking-tight text-ih-ok-fg">
                {m.portal_invoice_finalizing_short()}
              </span>
            ) : (
              <span className={`font-serif text-[24px] font-semibold tracking-tight ${balanceDue > 0 ? "text-ih-fg-1" : "text-ih-ok-fg"}`}>
                {money(balanceDue, cur)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pay panel — Stripe Payment Element (bring-your-own-keys) */}
      {payable && !processing && (
        <div className="px-7 pb-7 print:hidden">
          <StripePayPanel id={inspectionId} portalToken={portalToken} balanceDue={balanceDue} inspectorName={invoice.inspectorName} brandColor={brand.primaryColor} currency={invoice.currency} />
        </div>
      )}

      {/* Confirmation — one block for both settled states; only the second line
          differs (what happens next vs. what to do with the receipt). */}
      {settled && (
        <div className="px-7 pb-7 print:hidden">
          <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
            <p className="text-[13px] font-semibold text-ih-ok-fg">{m.portal_invoice_payment_received()}</p>
            <p className="text-[12px] text-ih-fg-3 mt-1">
              {processing ? m.portal_invoice_finalizing() : m.portal_invoice_keep_receipt()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
