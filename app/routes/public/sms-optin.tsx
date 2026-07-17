import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import type { Route } from "./+types/sms-optin";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

export function meta() {
    return [{ title: m.sms_optin_meta_title() }];
}

interface OptinData {
    companyName: string;
    disclosureText: string;
    privacyUrl: string | null;
    termsUrl: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader — resolve the token to disclosure + company name (BFF)      */
/* ------------------------------------------------------------------ */

export async function loader({ params, context }: Route.LoaderArgs) {
    const token = params.token ?? "";
    try {
        const api = createApi(context);
        const res = (await api.smsPublic.sms["optin-resolve"].$get({
            query: { token },
        })) as unknown as Response;
        if (!res.ok) return { data: null as OptinData | null, token };
        const body = (await res.json()) as { data?: OptinData };
        return { data: body.data ?? null, token };
    } catch {
        return { data: null as OptinData | null, token };
    }
}

/* ------------------------------------------------------------------ */
/*  Action — confirm opt-in (BFF, no client fetch)                     */
/* ------------------------------------------------------------------ */

export async function action({ params, context }: Route.ActionArgs) {
    const token = params.token ?? "";
    try {
        const api = createApi(context);
        const res = (await api.smsPublic.sms["optin-confirm"].$post({
            json: { token },
        })) as unknown as Response;
        if (res.ok) return { ok: true as const };
        return { ok: false as const, error: m.sms_optin_error_confirm_failed() };
    } catch {
        return { ok: false as const, error: m.sms_optin_error_service_unavailable() };
    }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SmsOptinPage() {
    const { data } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const submitting = navigation.state === "submitting";

    if (!data) {
        return (
            <div className="min-h-screen bg-ih-bg-app flex items-center justify-center px-4">
                <div className="max-w-md w-full bg-ih-bg-card border border-ih-border rounded-2xl p-8 text-center">
                    <h1 className="text-xl font-bold text-ih-fg-1 mb-2">{m.sms_optin_notfound_heading()}</h1>
                    <p className="text-sm text-ih-fg-3">
                        {m.sms_optin_notfound_body()}
                    </p>
                </div>
            </div>
        );
    }

    if (actionData?.ok) {
        return (
            <div className="min-h-screen bg-ih-bg-app flex items-center justify-center px-4">
                <div className="max-w-md w-full bg-ih-bg-card border border-ih-border rounded-2xl p-8 text-center">
                    <h1 className="text-xl font-bold text-ih-fg-1 mb-2">{m.sms_optin_subscribed_heading()}</h1>
                    <p className="text-sm text-ih-fg-3">
                        {m.sms_optin_subscribed_body_1()}{data.companyName}{m.sms_optin_subscribed_body_2()}<strong>STOP</strong>{m.sms_optin_subscribed_body_3()}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-ih-bg-app flex items-center justify-center px-4">
            <div className="max-w-md w-full bg-ih-bg-card border border-ih-border rounded-2xl p-8">
                <h1 className="text-xl font-bold text-ih-fg-1 mb-1">{m.sms_optin_heading()}</h1>
                <p className="text-sm text-ih-fg-3 mb-4">
                    {m.sms_optin_intro_1()}{" "}
                    <strong>{data.companyName}</strong>{m.sms_optin_intro_2()}
                </p>
                <div className="bg-ih-bg-muted border border-ih-border rounded-xl p-4 mb-5">
                    <p className="text-xs text-ih-fg-3 leading-relaxed">{data.disclosureText}</p>
                    {(data.privacyUrl || data.termsUrl) && (
                        <p className="text-xs text-ih-fg-3 leading-relaxed mt-2">
                            {data.privacyUrl && (
                                <a href={data.privacyUrl} target="_blank" rel="noreferrer" className="underline">{m.sms_optin_privacy_link()}</a>
                            )}
                            {data.privacyUrl && data.termsUrl && <span> · </span>}
                            {data.termsUrl && (
                                <a href={data.termsUrl} target="_blank" rel="noreferrer" className="underline">{m.sms_optin_terms_link()}</a>
                            )}
                        </p>
                    )}
                </div>
                {actionData?.error && (
                    <p className="text-sm text-ih-bad-fg mb-3" role="alert">
                        {actionData.error}
                    </p>
                )}
                <Form method="post">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full px-4 py-3 rounded-xl bg-ih-primary text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
                    >
                        {submitting ? m.sms_optin_submit_pending() : m.sms_optin_submit()}
                    </button>
                </Form>
                <p className="text-xs text-ih-fg-3 mt-4 text-center">
                    {m.sms_optin_footer_disclosure()}
                </p>
            </div>
        </div>
    );
}
