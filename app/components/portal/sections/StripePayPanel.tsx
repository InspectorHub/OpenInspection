/**
 * <StripePayPanel> — the Stripe Elements pay panel for an invoice, extracted from
 * <PaymentSection>. Client-only: rendered after a click. Owns its own <Elements>
 * provider and lazy-loads `loadStripe` only after the client clicks "Pay".
 *
 * Payment-intent / clientSecret / confirmPayment logic is byte-identical to the
 * original inline implementation — keyed by INSPECTION ID, POSTing
 * `/api/public/inspections/:id/pay-intent`. lint:ds — only `ih-*` tokens.
 */
import { useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { money } from "./payment-helpers";

type PayPhase = "idle" | "loading" | "ready" | "unavailable" | "paid_already";

export function StripePayPanel({ id, balanceDue, inspectorName, brandColor }: { id: string; balanceDue: number; inspectorName: string; brandColor: string | null }) {
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
            className="w-full h-11 rounded-lg bg-ih-primary text-ih-primary-fg font-bold text-sm hover:opacity-95 hover:-translate-y-px transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait disabled:translate-y-0"
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
        className="w-full h-11 rounded-lg bg-ih-primary text-ih-primary-fg font-bold text-sm hover:opacity-95 hover:-translate-y-px transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait disabled:translate-y-0"
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
