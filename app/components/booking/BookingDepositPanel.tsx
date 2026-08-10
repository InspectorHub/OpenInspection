/**
 * The deposit step, shown AFTER the booking exists.
 *
 * The ordering is the design, not an implementation detail. The appointment is
 * already saved by the time this renders, so a declined card leaves a real
 * booking with an unpaid deposit that the tenant can see and chase — never a
 * silent drop. That is why there is no "pay to confirm" wording anywhere here.
 *
 * Nothing this component observes is trusted as payment either. Stripe redirects
 * back to the booking page on success, and the ledger row is written by the
 * webhook; the confirmation this shows is about the CARD, and it says so.
 *
 * Modelled on `portal/sections/StripePayPanel` — same lazy `loadStripe` after a
 * click, same Elements-in-a-card shape — but not shared with it: that one is
 * keyed on an invoice and gated on a portal grant, and this one exists
 * precisely for the case where neither is true.
 * lint:ds — only `ih-*` tokens.
 */
import { useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { formatCurrency } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { buildStripeElementsOptions } from "~/lib/stripe-elements-options";
import { m } from "~/paraglide/messages";

type Phase = "idle" | "loading" | "ready" | "settled" | "unavailable";

export function BookingDepositPanel({
  inspectionId,
  depositCents,
  currency,
  companyName,
}: {
  inspectionId: string;
  depositCents: number;
  currency: string;
  companyName: string;
}) {
  // No session on a public booking page, so this resolves to the default —
  // which is correct here: the visitor is anonymous and we have no preference
  // of theirs to honour.
  const locale = useDisplayLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);
  const [returnUrl, setReturnUrl] = useState("");

  const amount = formatCurrency(depositCents, { locale, currency });

  async function startPayment() {
    setReturnUrl(typeof window !== "undefined" ? window.location.href : "");
    setPhase("loading");
    try {
      const res = await fetch(`/api/public/inspections/${inspectionId}/deposit-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { clientSecret?: string; publishableKey?: string };
      };
      if (res.ok && body.data?.clientSecret && body.data?.publishableKey) {
        setStripePromise(loadStripe(body.data.publishableKey));
        setClientSecret(body.data.clientSecret);
        setPhase("ready");
        return;
      }
      // 404 here means the deposit is already settled — most often because the
      // webhook landed while this page was open. Nothing is owed, and saying
      // "unavailable" would be a lie the client would phone about.
      setPhase(res.status === 404 ? "settled" : "unavailable");
    } catch {
      setPhase("unavailable");
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-ih-border bg-ih-bg-muted p-4 text-left">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-[13px] font-semibold text-ih-fg-1">{m.booking_deposit_pay_heading()}</span>
        <span className="text-[18px] font-semibold text-ih-fg-1 tabular-nums">{amount}</span>
      </div>
      <p className="text-[12px] text-ih-fg-3 leading-relaxed mb-3">
        {m.booking_deposit_pay_body({ company: companyName })}
      </p>

      {(phase === "idle" || phase === "loading") && (
        <>
          <button
            type="button"
            onClick={startPayment}
            disabled={phase === "loading"}
            className="w-full h-11 rounded-lg bg-ih-primary text-ih-primary-fg font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            {phase === "loading" ? m.booking_deposit_starting() : m.booking_deposit_pay_button({ amount })}
          </button>
          {/* The appointment is already made. Say so beside the button, or the
              client reads the deposit as the thing that confirms it. */}
          <p className="mt-2 text-center text-[11px] text-ih-fg-2">{m.booking_deposit_already_booked()}</p>
        </>
      )}

      {phase === "ready" && clientSecret && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={buildStripeElementsOptions({ clientSecret, brandColor: null, displayLocale: locale })}
        >
          <DepositForm amount={amount} returnUrl={returnUrl} />
        </Elements>
      )}

      {phase === "settled" && (
        <p className="text-[12px] text-ih-fg-3 leading-relaxed">{m.booking_deposit_already_paid()}</p>
      )}

      {phase === "unavailable" && (
        <p className="text-[12px] text-ih-fg-3 leading-relaxed">
          {m.booking_deposit_unavailable({ company: companyName })}
        </p>
      )}
    </div>
  );
}

function DepositForm({ amount, returnUrl }: { amount: string; returnUrl: string }) {
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
      confirmParams: { return_url: returnUrl || (typeof window !== "undefined" ? window.location.href : "") },
    });
    // On success Stripe redirects; we only reach here on error. A decline is
    // NOT a failed booking — the copy has to keep those apart.
    if (payErr) {
      setError(payErr.message ?? m.booking_deposit_error_generic());
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full h-11 rounded-lg bg-ih-primary text-ih-primary-fg font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-wait"
      >
        {submitting ? m.booking_deposit_processing() : m.booking_deposit_pay_button({ amount })}
      </button>
      {error && (
        <div className="rounded-md bg-ih-bad-bg px-3 py-2">
          <p className="text-[12px] font-semibold text-ih-bad-fg">{error}</p>
          <p className="mt-0.5 text-[11px] text-ih-bad-fg">{m.booking_deposit_decline_keeps_booking()}</p>
        </div>
      )}
    </form>
  );
}
