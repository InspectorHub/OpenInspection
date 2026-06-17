import { useState, useRef, useEffect, useCallback } from "react";
import { useLoaderData, useSearchParams, useFetcher } from "react-router";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Route } from "./+types/checkout";
import { createApi } from "~/lib/api-client.server";
import { SanitizedHtml } from "~/components/SanitizedHtml";
import { brandTokens } from "~/lib/brand";
import {
    OnBehalfFields,
    onBehalfPayload,
    EMPTY_ON_BEHALF,
    type OnBehalfValue,
} from "~/components/agreements/OnBehalfFields";
import {
    deriveCheckoutState,
    type SignerStatus,
    type StepState,
} from "~/lib/checkout-steps";

export function meta() {
    return [{ title: "Sign & Pay - OpenInspection" }];
}

interface CheckoutData {
    signer: { name: string; role: "client" | "co_client" | "agent" | "other"; status: SignerStatus };
    agreement: { name: string; content: string; contentHash: string };
    envelope: {
        status: SignerStatus;
        completionPolicy: "all" | "one";
        progress: { signed: number; total: number };
    };
    invoice: { id: string; amountCents: number; status: "paid" | "partial" | "unpaid" } | null;
    payment: { required: boolean; paid: boolean };
    inspection: { id: string; propertyAddress: string | null };
    branding: { companyName: string; primaryColor: string | null };
}

export async function loader({ params, context }: Route.LoaderArgs) {
    const api = createApi(context);
    // Combined checkout context lives on the bookings router (GET
    // /api/public/checkout/:token); the tenant resolves from the slug
    // server-side via the PUBLIC_PREFIXES path-param resolver.
    let res: Response;
    try {
        res = (await api.bookings.checkout[":token"].$get({
            param: { token: params.token ?? "" },
        })) as unknown as Response;
    } catch {
        throw new Response("Service unavailable", { status: 503 });
    }
    if (!res.ok) throw new Response("Not found", { status: 404 });
    const body = (await res.json()) as { data?: CheckoutData };
    const data = body.data;
    if (!data) throw new Response("Not found", { status: 404 });
    return { checkout: data, token: params.token ?? "", tenant: params.tenant ?? "" };
}

/* ------------------------------------------------------------------ */
/*  Action — sign POST via the BFF api client (no client fetch)        */
/* ------------------------------------------------------------------ */

export async function action({ request, params, context }: Route.ActionArgs) {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const api = createApi(context);
    const token = params.token ?? "";

    if (intent === "sign") {
        const signatureBase64 = String(form.get("signatureBase64") ?? "");
        if (!signatureBase64) return { ok: false, error: "Signature is required." };
        const onBehalfOf = form.get("onBehalfOf");
        const onBehalfDisclaimer = form.get("onBehalfDisclaimer");
        const res = (await api.bookings.agreements[":token"].sign.$post({
            param: { token },
            json: {
                signatureBase64,
                ...(onBehalfOf ? { onBehalfOf: String(onBehalfOf) } : {}),
                ...(onBehalfDisclaimer ? { onBehalfDisclaimer: String(onBehalfDisclaimer) } : {}),
            },
        })) as unknown as Response;
        if (res.ok) return { ok: true };
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, error: d?.error?.message ?? "Signing failed. Please try again." };
    }

    return { ok: false, error: "Unknown action." };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function CheckoutPage() {
    const { checkout, tenant } = useLoaderData<typeof loader>();
    const [searchParams] = useSearchParams();
    // After Stripe's confirmPayment redirect the page reloads with
    // ?redirect_status=succeeded; the webhook settles the invoice async.
    const justPaid = searchParams.get("redirect_status") === "succeeded";

    // Optimistic local sign flag — the loader re-runs after a successful
    // useFetcher submit (RR revalidation), but we also flip immediately.
    const [signedNow, setSignedNow] = useState(false);

    const effectiveSignerStatus: SignerStatus = signedNow ? "signed" : checkout.signer.status;
    // Only bump progress while the server hasn't reflected our sign yet —
    // after revalidation signer.status is 'signed' and the server count is
    // authoritative (bumping again would double-count in multi-signer envelopes).
    const effectiveProgress = signedNow
        && checkout.signer.status !== "signed"
        && checkout.envelope.progress.signed < checkout.envelope.progress.total
        ? { ...checkout.envelope.progress, signed: checkout.envelope.progress.signed + 1 }
        : checkout.envelope.progress;

    const state = deriveCheckoutState({
        signerStatus: effectiveSignerStatus,
        progress: effectiveProgress,
        completionPolicy: checkout.envelope.completionPolicy,
        payment: { ...checkout.payment, paid: checkout.payment.paid || justPaid },
        invoice: checkout.invoice ? { status: checkout.invoice.status } : null,
    });

    const brandStyle = brandTokens(checkout.branding.primaryColor);

    if (state.declined) {
        return (
            <Shell brandStyle={brandStyle} companyName={checkout.branding.companyName}>
                <div className="px-6 py-10 text-center">
                    <h1 className="text-xl font-bold text-ih-fg-1">Agreement declined</h1>
                    <p className="text-ih-fg-3 mt-2">
                        You declined this agreement. Contact {checkout.branding.companyName} if this was a mistake.
                    </p>
                </div>
            </Shell>
        );
    }

    return (
        <Shell brandStyle={brandStyle} companyName={checkout.branding.companyName}>
            {/* Progress header */}
            <div className="px-6 pt-6 sm:px-8 border-b border-ih-border pb-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-2">
                    Sign &amp; Pay
                </p>
                <h1 className="text-lg font-bold text-ih-fg-1 tracking-tight">{checkout.agreement.name}</h1>
                {checkout.inspection.propertyAddress && (
                    <p className="text-[13px] text-ih-fg-3 mt-0.5">{checkout.inspection.propertyAddress}</p>
                )}
                <div className="flex items-center gap-3 mt-4">
                    <StepPill index={1} label="Sign" state={state.sign} />
                    <div className="h-px flex-1 bg-ih-border" />
                    <StepPill index={2} label="Pay" state={state.pay} />
                </div>
            </div>

            {/* Completion banner */}
            {state.allComplete && (
                <CompleteCard tenant={tenant} inspectionId={checkout.inspection.id} />
            )}

            {/* Step 1 — Sign */}
            <SignCard
                agreementName={checkout.agreement.name}
                content={checkout.agreement.content}
                signerName={checkout.signer.name}
                progress={effectiveProgress}
                state={state.sign}
                onSigned={() => setSignedNow(true)}
            />

            {/* Step 2 — Pay */}
            <PayCard
                state={state.pay}
                invoice={checkout.invoice}
                inspectionId={checkout.inspection.id}
                brandColor={checkout.branding.primaryColor}
                justPaid={justPaid}
                companyName={checkout.branding.companyName}
            />
        </Shell>
    );
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

function Shell({
    children,
    brandStyle,
    companyName,
}: {
    children: React.ReactNode;
    brandStyle: React.CSSProperties;
    companyName: string;
}) {
    return (
        <div className="min-h-screen bg-ih-bg-app py-6 px-4" style={brandStyle}>
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 bg-ih-primary rounded-2xl flex items-center justify-center shadow-ih-popover">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span className="text-lg font-bold tracking-tight text-ih-fg-1">{companyName}</span>
                </div>
                <div className="bg-ih-bg-card rounded-lg shadow-ih-popover overflow-hidden">{children}</div>
                <p className="text-center text-[11px] text-ih-fg-4 mt-6">Powered by OpenInspection</p>
            </div>
        </div>
    );
}

function StepPill({ index, label, state }: { index: number; label: string; state: StepState }) {
    const done = state === "done" || state === "na";
    const active = state === "todo" || state === "waiting";
    return (
        <div className="flex items-center gap-2">
            <span
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${
                    done
                        ? "bg-ih-ok-bg text-ih-ok-fg"
                        : active
                          ? "bg-ih-primary text-white"
                          : "bg-ih-bg-muted text-ih-fg-4"
                }`}
            >
                {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                ) : (
                    index
                )}
            </span>
            <span className={`text-[13px] font-semibold ${done ? "text-ih-fg-2" : active ? "text-ih-fg-1" : "text-ih-fg-4"}`}>
                {label}
                {state === "na" && <span className="text-ih-fg-4 font-normal"> · not required</span>}
                {state === "waiting" && <span className="text-ih-fg-4 font-normal"> · waiting</span>}
            </span>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Sign card                                                 */
/* ------------------------------------------------------------------ */

function SignCard({
    agreementName,
    content,
    signerName,
    progress,
    state,
    onSigned,
}: {
    agreementName: string;
    content: string;
    signerName: string;
    progress: { signed: number; total: number };
    state: StepState;
    onSigned: () => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawing, setDrawing] = useState(false);
    const [hasMark, setHasMark] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [onBehalf, setOnBehalf] = useState<OnBehalfValue>(EMPTY_ON_BEHALF);
    const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
    const submitting = fetcher.state !== "idle";

    // The sign POST is dispatched via useFetcher to THIS route's action, which
    // forwards to the public sign endpoint through the BFF api client.
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.ok) onSigned();
            else setErrorMsg(fetcher.data.error ?? "Signing failed. Please try again.");
        }
    }, [fetcher.state, fetcher.data, onSigned]);

    const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const r = canvas.getBoundingClientRect();
        const src = "touches" in e ? e.touches[0] : e;
        return {
            x: (src.clientX - r.left) * (canvas.width / r.width),
            y: (src.clientY - r.top) * (canvas.height / r.height),
        };
    }, []);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    }, []);

    const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
        setDrawing(true);
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const p = getPos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
    };
    const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!drawing) return;
        setHasMark(true);
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const p = getPos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    };
    const handleEnd = () => setDrawing(false);
    const clearSig = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasMark(false);
    };

    // Sign POST goes through the route action (BFF) — never a client fetch.
    function submitSignature() {
        if (!hasMark) {
            setErrorMsg("Please draw your signature before submitting.");
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        const signatureBase64 = canvas.toDataURL("image/png");
        const payload = onBehalfPayload(onBehalf);
        setErrorMsg(null);
        const fd = new FormData();
        fd.set("intent", "sign");
        fd.set("signatureBase64", signatureBase64);
        if (payload.onBehalfOf) fd.set("onBehalfOf", payload.onBehalfOf);
        if (payload.onBehalfDisclaimer) fd.set("onBehalfDisclaimer", payload.onBehalfDisclaimer);
        // Post to this route's own action (default form action = current URL).
        fetcher.submit(fd, { method: "post" });
    }

    const isDone = state === "done" || state === "waiting";

    return (
        <section className="border-b border-ih-border">
            <div className="px-6 py-5 sm:px-8 border-b border-ih-border">
                <p className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">Step 1 · Agreement</p>
                <h2 className="text-[15px] font-bold text-ih-fg-1 mt-0.5">{agreementName}</h2>
                {progress.total > 1 && (
                    <p className="text-[12px] text-ih-fg-3 mt-0.5">
                        Signature {Math.min(progress.signed + (isDone ? 0 : 1), progress.total)} of {progress.total}
                    </p>
                )}
            </div>

            {/* Snapshot content (scrollable) */}
            <div className="px-6 py-5 sm:px-8 border-b border-ih-border max-h-72 overflow-y-auto">
                <SanitizedHtml
                    className="prose prose-sm max-w-none text-ih-fg-3 leading-relaxed"
                    html={content}
                />
            </div>

            {isDone ? (
                <div className="px-6 py-6 sm:px-8 text-center">
                    <div className="w-12 h-12 bg-ih-ok-bg rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-ih-ok-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h3 className="text-[15px] font-bold text-ih-fg-1">Agreement signed</h3>
                    {state === "waiting" ? (
                        <p className="text-[13px] text-ih-fg-3 mt-1">
                            Thank you, {signerName}. We&rsquo;re waiting on the other signer
                            {progress.total - progress.signed > 1 ? "s" : ""} to complete this agreement
                            ({progress.signed} of {progress.total} signed).
                        </p>
                    ) : (
                        <p className="text-[13px] text-ih-fg-3 mt-1">Thank you, {signerName}.</p>
                    )}
                </div>
            ) : (
                <div className="px-6 py-5 sm:px-8">
                    <p className="text-sm font-bold text-ih-fg-3 mb-3">Draw your signature below:</p>
                    <div
                        className="border-2 border-ih-border rounded-2xl overflow-hidden bg-ih-bg-app mb-3"
                        style={{ touchAction: "none" }}
                    >
                        <canvas
                            ref={canvasRef}
                            role="img"
                            aria-label="Signature pad — draw your signature here"
                            width={580}
                            height={180}
                            className="w-full cursor-crosshair block"
                            onMouseDown={handleStart}
                            onMouseMove={handleMove}
                            onMouseUp={handleEnd}
                            onMouseLeave={handleEnd}
                            onTouchStart={handleStart}
                            onTouchMove={handleMove}
                            onTouchEnd={handleEnd}
                        />
                    </div>

                    <OnBehalfFields value={onBehalf} onChange={setOnBehalf} disabled={submitting} />

                    {errorMsg && (
                        <div className="mt-4 px-3 py-2 rounded-md bg-ih-bad-bg text-[13px] font-medium text-ih-bad-fg text-center">
                            {errorMsg}
                        </div>
                    )}

                    <div className="flex gap-3 mt-4">
                        <button
                            type="button"
                            onClick={clearSig}
                            disabled={submitting}
                            className="flex-1 h-10 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-3 text-sm font-semibold hover:bg-ih-bg-muted transition-all disabled:opacity-50"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={submitSignature}
                            disabled={submitting}
                            className="flex-[2] h-10 px-4 bg-ih-primary text-white rounded-md font-bold text-sm hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? "Signing..." : "Sign Agreement"}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Pay card (reuses the invoice page's Stripe pay flow)       */
/* ------------------------------------------------------------------ */

function PayCard({
    state,
    invoice,
    inspectionId,
    brandColor,
    justPaid,
    companyName,
}: {
    state: StepState;
    invoice: { id: string; amountCents: number; status: "paid" | "partial" | "unpaid" } | null;
    inspectionId: string;
    brandColor: string | null;
    justPaid: boolean;
    companyName: string;
}) {
    return (
        <section className="px-6 py-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4 mb-3">Step 2 · Payment</p>

            {state === "na" && (
                <p className="text-[13px] text-ih-fg-3">No payment is required for this inspection.</p>
            )}

            {state === "done" && (
                <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
                    <p className="text-[13px] font-semibold text-ih-ok-fg">Payment received — thank you.</p>
                </div>
            )}

            {state === "todo" && invoice && justPaid && (
                <div className="rounded-xl border border-ih-ok bg-ih-ok-bg p-4 text-center">
                    <p className="text-[13px] font-semibold text-ih-ok-fg">Payment received — thank you.</p>
                    <p className="text-[12px] text-ih-fg-3 mt-1">
                        We&rsquo;re finalizing your receipt; it will appear here shortly.
                    </p>
                </div>
            )}

            {state === "todo" && invoice && !justPaid && (
                <PayPanel
                    inspectionId={inspectionId}
                    amountCents={invoice.amountCents}
                    brandColor={brandColor}
                    companyName={companyName}
                />
            )}
        </section>
    );
}

type PayPhase = "idle" | "loading" | "ready" | "unavailable" | "paid_already";

function PayPanel({
    inspectionId,
    amountCents,
    brandColor,
    companyName,
}: {
    /** Inspection id — the pay-intent endpoint is inspection-keyed (/api/public/inspections/:id/pay-intent), NOT invoice-keyed. */
    inspectionId: string;
    amountCents: number;
    brandColor: string | null;
    companyName: string;
}) {
    const [phase, setPhase] = useState<PayPhase>("idle");
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);

    async function startPayment() {
        setPhase("loading");
        try {
            const res = await fetch(`/api/public/inspections/${inspectionId}/pay-intent`, {
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
                <span className="text-[13px] font-semibold text-ih-fg-1">Pay for your inspection</span>
                <span className="font-serif text-[18px] font-semibold text-ih-fg-1">{money(amountCents)}</span>
            </div>

            {(phase === "idle" || phase === "loading") && (
                <>
                    <button
                        type="button"
                        onClick={startPayment}
                        disabled={phase === "loading"}
                        className="w-full h-11 rounded-lg bg-ih-primary text-white font-bold text-sm hover:opacity-95 transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait"
                    >
                        {phase === "loading" ? "Starting secure checkout…" : `Pay ${money(amountCents)}`}
                    </button>
                    <div className="flex items-center justify-center gap-1.5 mt-3 text-[11px] text-ih-fg-4">
                        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="7" width="10" height="6" rx="1" />
                            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                        </svg>
                        Secured by Stripe
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
                            variables: { colorPrimary: brandColor ?? "#6366f1", fontFamily: "inherit", borderRadius: "8px" },
                        },
                    }}
                >
                    <CheckoutPayForm amountCents={amountCents} returnUrl={returnUrl} />
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
                    <span className="font-semibold text-ih-fg-2">{companyName}</span> to arrange payment.
                </p>
            )}
        </div>
    );
}

function CheckoutPayForm({ amountCents, returnUrl }: { amountCents: number; returnUrl: string }) {
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
            confirmParams: { return_url: returnUrl },
        });
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
                className="w-full h-11 rounded-lg bg-ih-primary text-white font-bold text-sm hover:opacity-95 transition-all shadow-ih-card disabled:opacity-60 disabled:cursor-wait"
            >
                {submitting ? "Processing…" : `Pay ${money(amountCents)}`}
            </button>
            {error && <p className="text-[12px] text-ih-bad-fg font-medium">{error}</p>}
        </form>
    );
}

/* ------------------------------------------------------------------ */
/*  Completion card                                                    */
/* ------------------------------------------------------------------ */

function CompleteCard({ tenant, inspectionId }: { tenant: string; inspectionId: string }) {
    // Report URL is constructed from the path tenant slug + inspection id
    // (matches the /report/:tenant/:id public route). The report itself is
    // still gated server-side, so this is a convenience link, not a bypass.
    const reportHref = tenant ? `/report/${tenant}/${inspectionId}` : null;
    return (
        <div className="px-6 py-6 sm:px-8 bg-ih-ok-bg border-b border-ih-ok">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-ih-ok rounded-full flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-[15px] font-bold text-ih-ok-fg">All done — thank you!</h2>
                    <p className="text-[13px] text-ih-fg-2 mt-0.5">
                        Your agreement is signed and payment is settled.
                    </p>
                </div>
            </div>
            {reportHref && (
                <a
                    href={reportHref}
                    className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-md bg-ih-primary text-white text-sm font-bold hover:bg-ih-primary-600 transition-all"
                >
                    View your report
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </a>
            )}
        </div>
    );
}
