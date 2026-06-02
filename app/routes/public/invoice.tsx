import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/invoice";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Invoice - OpenInspection" }];
}

interface InvoiceData {
  number: string;
  date: string;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  clientName: string;
  inspectorName: string;
  lineItems: { description: string; amount: number }[];
  total: number;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  try {
    const api = createApi(context);
    const res = await api.publicReport.r[":id"].invoice.$get({ param: { id: params.id ?? "" } });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      invoice: (Object.keys(d).length > 0 ? d : null) as InvoiceData | null,
      error: res.ok ? null : "Invoice not found",
    };
  } catch {
    return { invoice: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
}

const STATUS_PILL: Record<string, string> = {
  paid: "bg-ih-ok-bg text-ih-ok-fg",
  sent: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  overdue: "bg-ih-bad-bg text-ih-bad-fg",
  draft: "bg-ih-bg-muted text-ih-fg-3",
  void: "bg-ih-bg-muted text-ih-fg-3",
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InvoicePage() {
  const { invoice, error } = useLoaderData<typeof loader>();
  const [payNote, setPayNote] = useState(false);

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-app">
        <div className="text-center">
          <h1 className="font-serif text-2xl font-semibold text-ih-fg-1">Invoice not found</h1>
          <p className="text-sm text-ih-fg-3 mt-2">{error ?? "This invoice is not available."}</p>
        </div>
      </div>
    );
  }

  // Derive the totals block from the available data (Gemini spec: Subtotal · Tax ·
  // Total · Amount Paid · Balance Due). Negative line items are discounts.
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
    <div className="min-h-screen bg-ih-bg-app py-8 px-4 print:bg-white print:py-0">
      <div className="max-w-[560px] mx-auto">
        {/* Document */}
        <div className="relative bg-ih-bg-card border border-ih-border rounded-2xl shadow-sm overflow-hidden print:shadow-none print:border-0">
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

          {/* Pay panel — Stripe Elements integration slot (not yet wired) */}
          {payable && (
            <div className="px-7 pb-7 print:hidden">
              <div className="rounded-xl border border-ih-border bg-slate-50 dark:bg-slate-800/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-semibold text-ih-fg-1">Pay this invoice</span>
                  <span className="font-serif text-[18px] font-semibold text-ih-fg-1">{money(balanceDue)}</span>
                </div>
                {/* TODO(payments): mount Stripe Elements here once the tenant's
                    Stripe Connect account is configured (bring-your-own-keys).
                    The button below is the wired CTA slot. */}
                <button
                  type="button"
                  onClick={() => setPayNote(true)}
                  className="w-full h-11 rounded-lg bg-ih-primary text-white font-bold text-sm hover:opacity-95 hover:-translate-y-px transition-all shadow-sm"
                >
                  Pay {money(balanceDue)}
                </button>
                {payNote ? (
                  <p className="mt-3 text-[12px] text-ih-fg-3 leading-relaxed">
                    Secure online card payment is being set up for this inspector. In the meantime,
                    contact <span className="font-semibold text-ih-fg-2">{invoice.inspectorName || "your inspector"}</span> to arrange payment.
                  </p>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 mt-3 text-[11px] text-ih-fg-4">
                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="7" width="10" height="6" rx="1" />
                      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                    </svg>
                    Secured by Stripe · No signature required
                  </div>
                )}
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

        {/* Actions + footer (outside the document, not printed) */}
        <div className="mt-4 flex items-center justify-between print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6V2h8v4M4 12H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1M4 10h8v4H4z" />
            </svg>
            Download PDF
          </button>
          <p className="text-[12px] text-ih-fg-4">
            Questions? Contact {invoice.inspectorName || "your inspector"}.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bits                                                               */
/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-0.5">{label}</p>
      <p className="text-[13px] text-ih-fg-1 font-medium truncate">{children}</p>
    </div>
  );
}

function Row({ label, value, muted, strong, tone }: { label: string; value: string; muted?: boolean; strong?: boolean; tone?: "ok" }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`${strong ? "font-bold text-ih-fg-1" : "text-ih-fg-3"} ${muted && !strong ? "text-ih-fg-3" : ""}`}>{label}</span>
      <span className={`font-mono tabular-nums ${tone === "ok" ? "text-ih-ok-fg" : strong ? "font-bold text-ih-fg-1" : "text-ih-fg-2"}`}>{value}</span>
    </div>
  );
}
