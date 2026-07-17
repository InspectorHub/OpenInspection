import { useLoaderData, useParams } from "react-router";
import type { Route } from "./+types/agreement-sign";
import { createApi } from "~/lib/api-client.server";
import {
    AgreementSection,
    type AgreementData,
} from "~/components/portal/sections/AgreementSection";
import { m } from "~/paraglide/messages";

export function meta() {
    return [{ title: m.agreement_sign_meta_title() }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
    try {
        const api = createApi(context);
        // The public agreement fetch lives on the bookings router (GET
        // /api/public/agreements/:token); tenant resolves from the slug server-side.
        const res = (await api.bookings.agreements[":token"].$get({
            param: { token: params.token ?? "" },
        })) as unknown as Response;
        const body = res.ok ? ((await res.json()) as { data?: AgreementData }) : {};
        const d = (body as { data?: AgreementData }).data ?? null;
        return {
            agreement: d,
            error: res.ok ? null : "Agreement not found",
            token: params.token ?? "",
            tenant: params.tenant ?? "",
        };
    } catch {
        return { agreement: null, error: "Service unavailable", token: "", tenant: "" };
    }
}

/* ------------------------------------------------------------------ */
/*  Action — sign / decline via the BFF api client (no client fetch)   */
/* ------------------------------------------------------------------ */

export async function action({ request, params, context }: Route.ActionArgs) {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const api = createApi(context);
    const token = params.token ?? "";

    if (intent === "sign") {
        const signatureBase64 = String(form.get("signatureBase64") ?? "");
        if (!signatureBase64) return { ok: false, intent, error: m.checkout_sign_error_signature_required() };
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
        if (res.ok) return { ok: true, intent };
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, intent, error: d?.error?.message ?? m.checkout_sign_error_failed() };
    }

    if (intent === "decline") {
        const reason = form.get("reason");
        const res = (await api.bookings.agreements[":token"].decline.$post({
            param: { token },
            json: { ...(reason ? { reason: String(reason) } : {}) },
        })) as unknown as Response;
        if (res.ok) return { ok: true, intent };
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, intent, error: d?.error?.message ?? m.agreement_sign_error_decline_failed() };
    }

    return { ok: false, intent, error: m.checkout_action_error_unknown() };
}

/* ------------------------------------------------------------------ */
/*  Standalone page — thin wrapper around <AgreementSection>.          */
/*  Route: /agreements/sign/:tenant/:token (:token = per-signer token).*/
/* ------------------------------------------------------------------ */

export default function AgreementSignPage() {
    const { agreement, error } = useLoaderData<typeof loader>();
    const params = useParams();
    const tenant = params.tenant ?? "";
    const token = params.token ?? "";
    const actionPath = `/agreements/sign/${tenant}/${token}`;

    return (
        <div className="min-h-screen bg-ih-bg-app py-6 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Brand header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-ih-primary rounded-2xl flex items-center justify-center shadow-ih-popover">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-ih-fg-1">OpenInspection</span>
                </div>

                <AgreementSection
                    agreement={agreement as AgreementData | null}
                    error={error}
                    tenant={tenant}
                    token={token}
                    actionPath={actionPath}
                />

                <p className="text-center text-[11px] text-ih-fg-4 mt-6">{m.checkout_powered_by()}</p>
            </div>
        </div>
    );
}
