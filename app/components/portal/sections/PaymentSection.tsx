/**
 * <PaymentSection> — the invoice display + Stripe pay form, extracted from the
 * standalone route `app/routes/public/invoice.tsx` so it can be rendered BOTH as
 * a standalone page AND inline inside the unified client-portal Hub (section ③,
 * "Payment").
 *
 * Data-source-agnostic: receives everything via props (no `useLoaderData`). The
 * pay flow is keyed by INSPECTION ID — it POSTs `/api/public/inspections/:id/pay-intent`
 * and reads `/api/public/inspections/:id/invoice` upstream; no signer token is required.
 *
 * Bare-content convention — it renders the invoice card + pay form ONLY; the page
 * chrome (max-width container, padding, page background) is supplied by the host
 * (the standalone route wrapper, or the Hub). It does NOT wrap itself in a
 * full-page shell.
 *
 * Stripe lazy-init — the inner pay panel owns its own <Elements> provider and
 * lazy-loads `loadStripe` only after the client clicks "Pay" (the existing
 * useEffect-free, click-driven `startPayment`). Because the Hub mounts only the
 * ACTIVE section's slot, Stripe never initializes until the Payment tab is open.
 *
 * return_url correctness — `confirmPayment` returns to `window.location.href`
 * (read inside the click handler, never at render → SSR-safe). Standalone that is
 * the invoice page; inline that is the Hub's `?section=payment` tab.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { brandTokens, type TenantBrand } from "~/lib/brand";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

export interface InvoiceData {
  number: string;
  date: string;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  clientName: string;
  inspectorName: string;
  lineItems: { description: string; amount: number }[];
  total: number;
}

export interface PaymentSectionProps {
  /** Mapped invoice (dollars), or null when none/unavailable. */
  invoice: InvoiceData | null;
  brand: TenantBrand;
  /** Inspection id — keys the pay-intent + invoice fetch. */
  inspectionId: string;
  /** Tenant privacy policy link (standalone footer only). */
  privacyUrl?: string | null;
  /** After Stripe redirect with ?redirect_status=succeeded (optimistic state). */
  justPaid?: boolean;
  /** Standalone page renders an error card; inline shows a quiet empty state. */
  error?: string | null;
  /** Standalone page shows print/contact actions + privacy footer. */
  showStandaloneChrome?: boolean;
}

/* ------------------------------------------------------------------ */
/* Pure adapter (unit-testable) */
/* ------------------------------------------------------------------ */

/**
 * Map invoice/payment data → a display mode. Pure: no React / router / window.
 *   - 'paid'          : paymentStatus 'paid' OR invoice status 'paid'.
 *   - 'needs-payment' : there is a positive balance owed and it is not paid/void.
 *   - 'none'          : no invoice, void, or draft with nothing owed.
 */
export function paymentSectionState(data: {
  paymentStatus?: string;
  status?: string;
  amountCents?: number;
  total?: number;
}): { mode: "paid" | "needs-payment" | "none"; amountCents?: number } {
  const cents =
    typeof data.amountCents === "number"
      ? data.amountCents
      : typeof data.total === "number"
        ? Math.round(data.total * 100)
        : undefined;

  const isPaid = data.paymentStatus === "paid" || data.status === "paid";
  if (isPaid) return { mode: "paid", amountCents: cents };

  const isVoid = data.status === "void";
  const owes = typeof cents === "number" ? cents > 0 : false;
  if (!isVoid && owes) return { mode: "needs-payment", amountCents: cents };

  return { mode: "none", amountCents: cents };
}

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

const STATUS_PILL: Record<string, string> = {
  paid: "bg-ih-ok-bg text-ih-ok-fg",
  sent: "bg-ih-info-bg text-ih-info-fg",
  overdue: "bg-ih-bad-bg text-ih-bad-fg",
  draft: "bg-ih-bg-muted text-ih-fg-3",
  void: "bg-ih-bg-muted text-ih-fg-3",
};

/* ------------------------------------------------------------------ */
/* Section */
/* ------------------------------------------------------------------ */

export function PaymentSection({
  invoice,
  brand,
  inspectionId,
  privacyUrl,
  justPaid = false,
  error,
  showStandaloneChrome = false,
}: PaymentSectionProps) {
  if (error || !invoice) {
    return (
      <div className="rounded-xl border border-ih-border bg-ih-bg-card p-6 text-center">
        <h1 className="font-serif text-xl font-semibold text-ih-fg-1">No invoice yet</h1>
        <p className="text-sm text-ih-fg-3 mt-2">{error ?? "There is no invoice for this inspection yet."}</p>
      </div>
    );
  }

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
    <div style={brandTokens(brand.primaryColor)}>
      {/* Document */}
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
            <PayPanel id={inspectionId} balanceDue={balanceDue} inspectorName={invoice.inspectorName} brandColor={brand.primaryColor} />
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

      {/* Actions + footer (standalone page only; outside the document, not printed) */}
      {showStandaloneChrome && (
        <>
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
          {privacyUrl && (
            <p className="mt-8 text-center text-xs text-ih-fg-3 print:hidden">
              <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pay panel — Stripe Elements (client-only; rendered after a click) */
/* ------------------------------------------------------------------ */

type PayPhase = "idle" | "loading" | "ready" | "unavailable" | "paid_already";

function PayPanel({ id, balanceDue, inspectorName, brandColor }: { id: string; balanceDue: number; inspectorName: string; brandColor: string | null }) {
  const [phase, setPhase] = useState<PayPhase>("idle");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);
  // The return target is captured at click time so `window` is never read during
  // render (SSR-safe). It is the CURRENT url — the invoice page standalone, or the
  // Hub's `?section=payment` tab when mounted inline — so Stripe redirects back to
  // wherever the client started paying.
  const [returnUrl, setReturnUrl] = useState("");

  async function startPayment() {
    setReturnUrl(typeof window !== "undefined" ? window.location.href : "");
    setPhase("loading");
    try {
      const res = await fetch(`/api/public/inspections/${id}/pay-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { clientSecret?: string; publishableKey?: string };
        error?: { code?: string };
      };
      if (res.ok && body.data?.clientSecret && body.data?.publishableKey) {
        setStripePromise(loadStripe(body.data.publishableKey));
        setClientSecret(body.data.clientSecret);
        setPhase("ready");
        return;
      }
      setPhase(body.error?.code === "INVOICE_NOT_PAYABLE" ? "paid_already" : "unavailable");
    } catch {
      setPhase("unavailable");
    }
  }

  return (
    <div className="rounded-xl border border-ih-border bg-ih-bg-muted p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-ih-fg-1">Pay this invoice</span>
        <span className="font-serif text-[18px] font-semibold text-ih-fg-1">{money(balanceDue)}</span>
      </div>

      {(phase === "idle" || phase === "loading") && (
        <>
          <button
            type="button"
            onClick={startPayment}
            disabled={phase === "loading"}
            className="w-full h-11 rounded-lg bg-ih-primary text-white font-bold text-sm hover:opacity-95 hover:-translate-y-px transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait disabled:translate-y-0"
          >
            {phase === "loading" ? "Starting secure checkout…" : `Pay ${money(balanceDue)}`}
          </button>
          <div className="flex items-center justify-center gap-1.5 mt-3 text-[11px] text-ih-fg-4">
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="7" width="10" height="6" rx="1" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            Secured by Stripe · No signature required
          </div>
        </>
      )}

      {phase === "ready" && clientSecret && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "flat",
              // Stripe Elements render in an iframe — CSS vars don't reach it,
              // so the resolved brand hex (or the platform token default) goes in.
              variables: { colorPrimary: brandColor ?? "#6366f1", fontFamily: "inherit", borderRadius: "8px" },
            },
          }}
        >
          <CheckoutForm balanceDue={balanceDue} returnUrl={returnUrl} />
        </Elements>
      )}

      {phase === "paid_already" && (
        <p className="mt-1 text-[12px] text-ih-fg-3 leading-relaxed">
          This invoice has already been paid. Refresh the page to see your receipt.
        </p>
      )}

      {phase === "unavailable" && (
        <p className="mt-1 text-[12px] text-ih-fg-3 leading-relaxed">
          Secure online card payment isn&rsquo;t available right now. Please contact{" "}
          <span className="font-semibold text-ih-fg-2">{inspectorName || "your inspector"}</span> to arrange payment.
        </p>
      )}
    </div>
  );
}

function CheckoutForm({ balanceDue, returnUrl }: { balanceDue: number; returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: payErr } = await stripe.confirmPayment({
      elements,
      // Return to wherever the client started paying (invoice page standalone,
      // or the Hub payment tab inline). Captured at click time → SSR-safe.
      confirmParams: { return_url: returnUrl || (typeof window !== "undefined" ? window.location.href : "") },
    });
    // On success Stripe redirects to return_url; we only reach here on error.
    if (payErr) {
      setError(payErr.message ?? "Payment could not be completed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full h-11 rounded-lg bg-ih-primary text-white font-bold text-sm hover:opacity-95 hover:-translate-y-px transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait disabled:translate-y-0"
      >
        {submitting ? "Processing…" : `Pay ${money(balanceDue)}`}
      </button>
      {error && <p className="text-[12px] text-ih-bad-fg font-medium">{error}</p>}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-ih-fg-4">
        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="7" width="10" height="6" rx="1" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
        Secured by Stripe
      </div>
    </form>
  );
}

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

export default PaymentSection;
