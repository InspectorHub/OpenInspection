/**
 * <InvoiceDisplay> — the invoice document card (header · line items · totals ·
 * PAID stamp · pay-panel slot · paid confirmation), extracted from
 * <PaymentSection>. Pure presentation keyed off the mapped invoice (dollars);
 * the Stripe pay flow is delegated to <StripePayPanel>. lint:ds — only `ih-*`.
 */
import { money, STATUS_PILL, Field, Row, type InvoiceData } from "./payment-helpers";
import { StripePayPanel } from "./StripePayPanel";
import type { TenantBrand } from "~/lib/brand";

interface InvoiceDisplayProps {
  invoice: InvoiceData;
  brand: TenantBrand;
  inspectionId: string;
  justPaid: boolean;
}

export function InvoiceDisplay({ invoice, brand, inspectionId, justPaid }: InvoiceDisplayProps) {
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
  const amountPaid = isPaid ? total : 0;
  const balanceDue = isPaid ? 0 : total;
  const payable = !isPaid && !isVoid && balanceDue > 0;

  return (
    <div className="relative bg-ih-bg-card border border-ih-border rounded-2xl shadow-ih-card overflow-hidden print:shadow-none print:border-0">
      {/* PAID stamp */}
      {isPaid && (
        <div className="pointer-events-none absolute top-16 right-6 -rotate-12 select-none">
          <span className="inline-block px-4 py-1.5 rounded-md border-[3px] border-ih-ok-fg text-ih-ok-fg font-extrabold tracking-[0.25em] text-2xl uppercase opacity-90">
            Paid
          </span>
        </div>
      )}

      {/* Header band */}
      <div className="px-7 pt-7 pb-5 border-b border-ih-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">Invoice</p>
            <h1 className="font-serif text-[26px] leading-tight font-semibold tracking-tight text-ih-fg-1 mt-0.5">
              {invoice.number}
            </h1>
          </div>
          <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded ${STATUS_PILL[invoice.status] ?? STATUS_PILL.draft}`}>
            {invoice.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-[13px]">
          <Field label="From">{invoice.inspectorName || "Your inspector"}</Field>
          <Field label="Bill to">{invoice.clientName || "—"}</Field>
          <Field label="Issued">{invoice.date || "—"}</Field>
          <Field label="Due">{invoice.dueDate || "On receipt"}</Field>
        </div>
      </div>

      {/* Line items */}
      <div className="px-7 py-5">
        <div className="flex items-baseline justify-between pb-2 mb-1 border-b border-ih-border text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">
          <span>Description</span>
          <span>Amount</span>
        </div>
        {items.length === 0 && <p className="py-3 text-[13px] text-ih-fg-4">No line items.</p>}
        {items.map((item, i) => (
          <div key={i} className="flex items-baseline justify-between py-2.5 border-b border-ih-border/60 last:border-b-0">
            <span className={`text-[13px] ${item.amount < 0 ? "text-ih-ok-fg" : "text-ih-fg-1"}`}>{item.description}</span>
            <span className={`text-[13px] font-mono tabular-nums ${item.amount < 0 ? "text-ih-ok-fg" : "text-ih-fg-1"}`}>
              {item.amount < 0 ? `−${money(Math.abs(item.amount))}` : money(item.amount)}
            </span>
          </div>
        ))}

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-ih-border space-y-1.5 text-[13px]">
          <Row label="Subtotal" value={money(subtotal)} muted />
          {discountTotal < 0 && <Row label="Discount" value={`−${money(Math.abs(discountTotal))}`} muted tone="ok" />}
          <Row label="Total" value={money(total)} strong />
          {isPaid && <Row label="Amount paid" value={`−${money(amountPaid)}`} muted tone="ok" />}
          <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-ih-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">{isPaid ? "Balance" : "Balance due"}</span>
            <span className={`font-serif text-[24px] font-semibold tracking-tight ${balanceDue > 0 ? "text-ih-fg-1" : "text-ih-ok-fg"}`}>
              {money(balanceDue)}
            </span>
          </div>
        </div>
      </div>

      {/* Pay panel — Stripe Payment Element (bring-your-own-keys) */}
      {payable && !justPaid && (
        <div className="px-7 pb-7 print:hidden">
          <StripePayPanel id={inspectionId} balanceDue={balanceDue} inspectorName={invoice.inspectorName} brandColor={brand.primaryColor} />
        </div>
      )}

      {/* Optimistic post-redirect state — webhook settles the invoice async */}
      {payable && justPaid && (
        <div className="px-7 pb-7 print:hidden">
          <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
            <p className="text-[13px] font-semibold text-ih-ok-fg">Payment received — thank you.</p>
            <p className="text-[12px] text-ih-fg-3 mt-1">We&rsquo;re finalizing your receipt; your paid invoice will appear here shortly.</p>
          </div>
        </div>
      )}

      {/* Paid confirmation */}
      {isPaid && (
        <div className="px-7 pb-7 print:hidden">
          <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
            <p className="text-[13px] font-semibold text-ih-ok-fg">Payment received — thank you.</p>
            <p className="text-[12px] text-ih-fg-3 mt-1">Keep this receipt for your records.</p>
          </div>
        </div>
      )}
    </div>
  );
}
