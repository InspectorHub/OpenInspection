import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import type { Route } from "./+types/sms-optin";
import { createApi } from "~/lib/api-client.server";

export function meta() {
    return [{ title: "Text message updates - OpenInspection" }];
}

interface OptinData {
    companyName: string;
    disclosureText: string;
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
        return { ok: false as const, error: "We couldn't confirm your opt-in. The link may have expired." };
    } catch {
        return { ok: false as const, error: "Service unavailable. Please try again later." };
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
                    <h1 className="text-xl font-bold text-ih-fg-1 mb-2">Link not found</h1>
                    <p className="text-sm text-ih-fg-3">
                        This opt-in link is invalid or has expired. If you'd still like text
                        updates, please contact your inspection company.
                    </p>
                </div>
            </div>
        );
    }

    if (actionData?.ok) {
        return (
            <div className="min-h-screen bg-ih-bg-app flex items-center justify-center px-4">
                <div className="max-w-md w-full bg-ih-bg-card border border-ih-border rounded-2xl p-8 text-center">
                    <h1 className="text-xl font-bold text-ih-fg-1 mb-2">You're subscribed</h1>
                    <p className="text-sm text-ih-fg-3">
                        You'll receive appointment and report updates from {data.companyName} by
                        text. Reply <strong>STOP</strong> anytime to opt out.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-ih-bg-app flex items-center justify-center px-4">
            <div className="max-w-md w-full bg-ih-bg-card border border-ih-border rounded-2xl p-8">
                <h1 className="text-xl font-bold text-ih-fg-1 mb-1">Text me updates</h1>
                <p className="text-sm text-ih-fg-3 mb-4">
                    Get appointment reminders and report-ready alerts from{" "}
                    <strong>{data.companyName}</strong> by text message.
                </p>
                <div className="bg-ih-bg-muted border border-ih-border rounded-xl p-4 mb-5">
                    <p className="text-xs text-ih-fg-3 leading-relaxed">{data.disclosureText}</p>
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
                        {submitting ? "Confirming..." : "Yes, text me updates"}
                    </button>
                </Form>
                <p className="text-xs text-ih-fg-3 mt-4 text-center">
                    Message &amp; data rates may apply. Reply STOP to opt out.
                </p>
            </div>
        </div>
    );
}
