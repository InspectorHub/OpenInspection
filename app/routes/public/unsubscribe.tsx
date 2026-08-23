import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import type { Route } from "./+types/unsubscribe";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

/**
 * Where an emailed unsubscribe link lands.
 *
 * ── The loader must not unsubscribe anybody ─────────────────────────────────
 * Mail clients prefetch links, and corporate link scanners and anti-malware
 * appliances fetch every URL in every message before a human sees it. So this
 * loader is a pure read — it asks the API what the link COVERS — and the change
 * happens only in the action, behind a control someone has to press. Getting
 * this the other way round means a virus scanner unsubscribes the recipient
 * from mail they never opened, and neither of them ever finds out.
 *
 * ── No session, by construction ─────────────────────────────────────────────
 * The reader is not signed in and may have no account to sign into: their
 * address is the whole of their identity here, and it rides inside the signed
 * token. The API half lives under `/api/public`, which the JWT middleware
 * short-circuits; this page path is listed in that middleware's public set for
 * the same reason, so a reader who happens to BE signed in — an agent held by
 * the agent-terms gate, say — is not stopped on the way to their own way out.
 */

interface UnsubscribeData {
    companyName: string;
    label: string;
    classId: string;
    muted: boolean;
}

export function meta() {
    return [
        { title: m.public_unsubscribe_meta_title() },
        // Nothing here should be indexed or followed: the URL contains a token.
        { name: "robots", content: "noindex, nofollow" },
    ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
    const token = params.token ?? "";
    try {
        const api = createApi(context);
        const res = (await api.unsubscribe.unsubscribe.resolve.$get({
            query: { token },
        })) as unknown as Response;
        if (!res.ok) return { data: null as UnsubscribeData | null };
        const body = (await res.json()) as { data?: UnsubscribeData };
        return { data: body.data ?? null };
    } catch {
        return { data: null as UnsubscribeData | null };
    }
}

export async function action({ params, request, context }: Route.ActionArgs) {
    const token = params.token ?? "";
    const form = await request.formData();
    // The form says which direction. "Off" and "back on" are the same one cell
    // of the same person's preferences — see server/api/unsubscribe.ts for why
    // the way back matters as much as the way out.
    const enabled = form.get("enabled") === "true";
    try {
        const api = createApi(context);
        const res = (await api.unsubscribe.unsubscribe.$post({
            json: { token, enabled },
        })) as unknown as Response;
        if (res.ok) return { ok: true as const, enabled };
        return { ok: false as const, enabled, error: m.public_unsubscribe_error() };
    } catch {
        return { ok: false as const, enabled, error: m.public_unsubscribe_error() };
    }
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-ih-bg-app flex items-center justify-center px-4">
            <div className="max-w-md w-full bg-ih-bg-card border border-ih-border rounded-2xl p-8">
                {children}
            </div>
        </div>
    );
}

export default function UnsubscribePage() {
    const { data } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const submitting = navigation.state === "submitting";

    if (!data) {
        return (
            <Shell>
                <h1 className="text-xl font-bold text-ih-fg-1 mb-2">{m.public_unsubscribe_invalid_heading()}</h1>
                <p className="text-sm text-ih-fg-3">{m.public_unsubscribe_invalid_body()}</p>
            </Shell>
        );
    }

    // Off — either because they just switched it off, or because they had
    // already done it and clicked the link again. ONE screen for both, and that
    // matters: an earlier version showed the confirm screen with a disabled
    // button to anyone arriving already-unsubscribed, which is a dead end at the
    // exact moment someone is checking whether the thing they did worked. The
    // way back has to be on this screen, not only in the seconds after acting.
    const off = actionData?.ok ? !actionData.enabled : data.muted;
    if (off) {
        return (
            <Shell>
                <h1 className="text-xl font-bold text-ih-fg-1 mb-2">
                    {actionData?.ok ? m.public_unsubscribe_done_heading() : m.public_unsubscribe_already_heading()}
                </h1>
                <p className="text-sm text-ih-fg-3 mb-3">
                    {m.public_unsubscribe_done_body_1()}{" "}
                    <strong className="text-ih-fg-1">{data.label}</strong>{" "}
                    {m.public_unsubscribe_done_body_2()}{" "}
                    <strong className="text-ih-fg-1">{data.companyName}</strong>.
                </p>
                <p className="text-sm text-ih-fg-3 mb-5">{m.public_unsubscribe_still_sent()}</p>
                <Form method="post">
                    <input type="hidden" name="enabled" value="true" />
                    <button
                        type="submit"
                        disabled={submitting}
                        className="text-sm font-semibold text-ih-primary underline disabled:opacity-50"
                    >
                        {submitting ? m.public_unsubscribe_resubscribe_pending() : m.public_unsubscribe_resubscribe()}
                    </button>
                </Form>
            </Shell>
        );
    }

    if (actionData?.ok && actionData.enabled) {
        return (
            <Shell>
                <h1 className="text-xl font-bold text-ih-fg-1 mb-2">{m.public_unsubscribe_back_heading()}</h1>
                <p className="text-sm text-ih-fg-3">
                    {m.public_unsubscribe_back_body()}{" "}
                    <strong className="text-ih-fg-1">{data.label}</strong>.
                </p>
            </Shell>
        );
    }

    return (
        <Shell>
            <h1 className="text-xl font-bold text-ih-fg-1 mb-2">{m.public_unsubscribe_heading()}</h1>
            <p className="text-sm text-ih-fg-3 mb-4">
                {m.public_unsubscribe_intro_1()}{" "}
                <strong className="text-ih-fg-1">{data.label}</strong>{" "}
                {m.public_unsubscribe_intro_2()}{" "}
                <strong className="text-ih-fg-1">{data.companyName}</strong>.
            </p>
            <p className="text-sm text-ih-fg-3 mb-5">{m.public_unsubscribe_still_sent()}</p>
            {actionData?.error && (
                <p className="text-sm text-ih-bad-fg mb-3" role="alert">{actionData.error}</p>
            )}
            {/* A POST, never a GET. The link that got the reader here was fetched
                by every scanner between the sender and their inbox; this is the
                first thing on the path a person had to do on purpose. */}
            <Form method="post">
                <input type="hidden" name="enabled" value="false" />
                <button
                    type="submit"
                    disabled={submitting}
                    className="w-full px-4 py-3 rounded-xl bg-ih-primary text-ih-fg-inverse text-sm font-semibold disabled:opacity-50 transition-opacity"
                >
                    {submitting ? m.public_unsubscribe_confirm_pending() : m.public_unsubscribe_confirm()}
                </button>
            </Form>
        </Shell>
    );
}
