import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/checkout";
import { createApi } from "~/lib/api-client.server";
import { brandTokens } from "~/lib/brand";
import {
    deriveCheckoutState,
    type SignerStatus,
} from "~/lib/checkout-steps";
import { CheckoutShell, StepPill, CompleteCard } from "~/components/checkout/CheckoutShell";
import { SignCard } from "~/components/checkout/SignCard";
import { PayCard } from "~/components/checkout/PayCard";
import { m } from "~/paraglide/messages";

export function meta() {
    return [{ title: m.checkout_meta_title() }];
}

interface CheckoutData {
    signer: { name: string; role: "client" | "co_client" | "agent" | "other"; status: SignerStatus };
    agreement: { name: string; content: string; contentHash: string };
    envelope: {
        status: SignerStatus;
        completionPolicy: "all" | "one";
        progress: { signed: number; total: number };
    };
    invoice: { id: string; amountCents: number; currency?: string; status: "paid" | "partial" | "unpaid" } | null;
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
        if (!signatureBase64) return { ok: false, error: m.checkout_sign_error_signature_required() };
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
        return { ok: false, error: d?.error?.message ?? m.checkout_sign_error_failed() };
    }

    return { ok: false, error: m.checkout_action_error_unknown() };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

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
            <CheckoutShell brandStyle={brandStyle} companyName={checkout.branding.companyName}>
                <div className="px-6 py-10 text-center">
                    <h1 className="text-xl font-bold text-ih-fg-1">{m.checkout_declined_heading()}</h1>
                    <p className="text-ih-fg-3 mt-2">
                        {m.checkout_declined_body({ companyName: checkout.branding.companyName })}
                    </p>
                </div>
            </CheckoutShell>
        );
    }

    return (
        <CheckoutShell brandStyle={brandStyle} companyName={checkout.branding.companyName}>
            {/* Progress header */}
            <div className="px-6 pt-6 sm:px-8 border-b border-ih-border pb-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-2">
                    {m.checkout_progress_eyebrow()}
                </p>
                <h1 className="text-lg font-bold text-ih-fg-1 tracking-tight">{checkout.agreement.name}</h1>
                {checkout.inspection.propertyAddress && (
                    <p className="text-[13px] text-ih-fg-3 mt-0.5">{checkout.inspection.propertyAddress}</p>
                )}
                <div className="flex items-center gap-3 mt-4">
                    <StepPill index={1} label={m.checkout_step_sign()} state={state.sign} />
                    <div className="h-px flex-1 bg-ih-border" />
                    <StepPill index={2} label={m.checkout_step_pay()} state={state.pay} />
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
        </CheckoutShell>
    );
}
