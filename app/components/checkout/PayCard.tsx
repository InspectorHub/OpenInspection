import { useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { StepState } from "~/lib/checkout-steps";
import { formatCurrency } from "~/lib/format";
import { useDisplayLocale, useDisplayCurrency } from "~/hooks/useSessionContext";
import { buildStripeElementsOptions } from "~/lib/stripe-elements-options";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Step 2 — Pay card (reuses the invoice page's Stripe pay flow)       */
/* ------------------------------------------------------------------ */

export function PayCard({
    state,
    invoice,
    inspectionId,
    brandColor,
    justPaid,
    companyName,
    portalToken,
}: {
    state: StepState;
    invoice: { id: string; amountCents: number; currency?: string; status: "paid" | "partial" | "unpaid" } | null;
    inspectionId: string;
    brandColor: string | null;
    justPaid: boolean;
    companyName: string;
    /**
     * IA-34 — the pay-intent endpoint requires a live client/co_client grant.
     * Checkout's own credential is a SIGNER token, so the endpoint that verified
     * it hands back this per-inspection PORTAL token for the same recipient.
     * Null (agent / other signer) → the pay panel degrades to "contact your
     * inspector" rather than issuing a call that will be refused.
     */
    portalToken: string | null;
}) {
    return (
        <section className="px-6 py-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3 mb-3">{m.checkout_pay_step_label()}</p>

            {state === "na" && (
                <p className="text-[13px] text-ih-fg-3">{m.checkout_pay_none_required()}</p>
            )}

            {state === "done" && (
                <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
                    <p className="text-[13px] font-semibold text-ih-ok-fg">{m.checkout_pay_received()}</p>
                </div>
            )}

            {state === "todo" && invoice && justPaid && (
                <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
                    <p className="text-[13px] font-semibold text-ih-ok-fg">{m.checkout_pay_received()}</p>
                    <p className="text-[12px] text-ih-fg-3 mt-1">
                        {m.checkout_pay_finalizing()}
                    </p>
                </div>
            )}

            {state === "todo" && invoice && !justPaid && (
                <PayPanel
                    inspectionId={inspectionId}
                    // The invoice TOTAL, not what the payment ledger says is
                    // still outstanding — the Stripe intent is minted
                    // server-side from this same figure, so quoting less here
                    // would show a price the payer is not charged. Charge and
                    // display only move together, and moving them is
                    // payment-collection behaviour with its own decisions to
                    // make. See the matching note in InvoiceDisplay.
                    amountCents={invoice.amountCents}
                    currency={invoice.currency}
                    brandColor={brandColor}
                    companyName={companyName}
                    portalToken={portalToken}
                />
            )}
        </section>
    );
}

type PayPhase = "idle" | "loading" | "ready" | "unavailable" | "paid_already";

function PayPanel({
    inspectionId,
    amountCents,
    currency: invoiceCurrency,
    brandColor,
    companyName,
    portalToken,
}: {
    /** Inspection id — the pay-intent endpoint is inspection-keyed (/api/public/inspections/:id/pay-intent), NOT invoice-keyed. */
    inspectionId: string;
    amountCents: number;
    /** The invoice's snapshot currency (Phase B) — wins over the session default. */
    currency?: string;
    brandColor: string | null;
    companyName: string;
    /** IA-34 — authenticates the pay-intent call; null → unavailable. */
    portalToken: string | null;
}) {
    const [phase, setPhase] = useState<PayPhase>("idle");
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);
    const locale = useDisplayLocale();
    const sessionCurrency = useDisplayCurrency();
    const currency = invoiceCurrency || sessionCurrency;

    async function startPayment() {
        if (!portalToken) {
            setPhase("unavailable");
            return;
        }
        setPhase("loading");
        try {
            const qs = `?token=${encodeURIComponent(portalToken)}`;
            const res = await fetch(`/api/public/inspections/${inspectionId}/pay-intent${qs}`, {
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

    const returnUrl =
        typeof window !== "undefined"
            ? `${window.location.origin}${window.location.pathname}?redirect_status=succeeded`
            : "";

    return (
        <div className="rounded-xl border border-ih-border bg-ih-bg-muted p-4">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold text-ih-fg-1">{m.checkout_pay_heading()}</span>
                <span className="font-serif text-[18px] font-semibold text-ih-fg-1">{formatCurrency(amountCents, { locale, currency })}</span>
            </div>

            {(phase === "idle" || phase === "loading") && (
                <>
                    <button
                        type="button"
                        onClick={startPayment}
                        disabled={phase === "loading"}
                        className="w-full h-11 rounded-lg bg-ih-primary text-ih-primary-fg font-bold text-sm hover:opacity-95 transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait"
                    >
                        {phase === "loading" ? m.checkout_pay_starting() : m.checkout_pay_button({ amount: formatCurrency(amountCents, { locale, currency }) })}
                    </button>
                    <div className="flex items-center justify-center gap-1.5 mt-3 text-[11px] text-ih-fg-2">
                        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="7" width="10" height="6" rx="1" />
                            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                        </svg>
                        {m.checkout_pay_secured_by_stripe()}
                    </div>
                </>
            )}

            {phase === "ready" && clientSecret && stripePromise && (
                <Elements
                    stripe={stripePromise}
                    options={buildStripeElementsOptions({ clientSecret, brandColor, displayLocale: locale })}
                >
                    <CheckoutPayForm amountCents={amountCents} returnUrl={returnUrl} currency={currency} />
                </Elements>
            )}

            {phase === "paid_already" && (
                <p className="mt-1 text-[12px] text-ih-fg-3 leading-relaxed">
                    {m.checkout_pay_already_paid()}
                </p>
            )}

            {phase === "unavailable" && (
                <p className="mt-1 text-[12px] text-ih-fg-3 leading-relaxed">
                    {m.checkout_pay_unavailable_before()}{" "}
                    <span className="font-semibold text-ih-fg-2">{companyName}</span>{m.checkout_pay_unavailable_after()}
                </p>
            )}
        </div>
    );
}

function CheckoutPayForm({ amountCents, returnUrl, currency: invoiceCurrency }: { amountCents: number; returnUrl: string; currency?: string }) {
    const stripe = useStripe();
    const elements = useElements();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const locale = useDisplayLocale();
    const sessionCurrency = useDisplayCurrency();
    const currency = invoiceCurrency || sessionCurrency;

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!stripe || !elements) return;
        setSubmitting(true);
        setError(null);
        const { error: payErr } = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: returnUrl },
        });
        if (payErr) {
            setError(payErr.message ?? m.checkout_pay_error_failed());
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <PaymentElement />
            <button
                type="submit"
                disabled={!stripe || submitting}
                className="w-full h-11 rounded-lg bg-ih-primary text-ih-primary-fg font-bold text-sm hover:opacity-95 transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait"
            >
                {submitting ? m.checkout_pay_processing() : m.checkout_pay_button({ amount: formatCurrency(amountCents, { locale, currency }) })}
            </button>
            {error && <p className="text-[12px] text-ih-bad-fg font-medium">{error}</p>}
        </form>
    );
}
