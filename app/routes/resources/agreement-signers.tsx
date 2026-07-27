/**
 * IA-65 — BFF resource route for per-signer envelope actions.
 *
 * Signer management (list / remind / copy-link) used to live in the `action` of
 * `/library/agreements`, which pinned every consumer to that one page: the
 * detail component imported `typeof action` from the route, so mounting it
 * anywhere else meant either duplicating the wiring or importing a page into a
 * page. Now the wiring lives here and the surfaces mount the component.
 *
 * No UI — action only. The underlying API is owner/manager-gated
 * (`requireRole` on the admin envelope routes), so callers must render these
 * affordances behind the same capability rather than discovering the refusal.
 */
import type { Route } from "./+types/agreement-signers";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { SignerRow } from "~/components/agreements/SignerList";
import { m } from "~/paraglide/messages";

/** Where consumers post; kept beside the handler so the two cannot drift. */
export const AGREEMENT_SIGNERS_ACTION = "/resources/agreement-signers";

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "");
    const requestId = String(formData.get("requestId") ?? "");
    const signerId = String(formData.get("signerId") ?? "");

    if (!token) return { ok: false as const, intent, error: m.library_agreements_err_api_status({ status: 401 }) };
    if (!requestId) return { ok: false as const, intent, error: m.library_agreements_err_missing_request_id() };
    const api = createApi(context, { token });

    if (intent === "load-signers") {
        const res = await api.admin.agreements.requests[":requestId"].signers.$get({ param: { requestId } });
        if (!res.ok) return { ok: false as const, intent, requestId, error: m.library_agreements_err_api_status({ status: res.status }) };
        const body = (await res.json()) as { data: SignerRow[] };
        return { ok: true as const, intent, requestId, signers: body.data };
    }

    if (intent === "remind") {
        const res = await api.admin.agreements.requests[":requestId"].signers[":signerId"].remind.$post({
            param: { requestId, signerId },
        });
        if (res.status === 429) return { ok: false as const, intent, signerId, error: m.library_agreements_err_remind_throttled() };
        if (res.status === 409) return { ok: false as const, intent, signerId, error: m.library_agreements_err_signer_not_awaiting() };
        if (!res.ok) return { ok: false as const, intent, signerId, error: m.library_agreements_err_remind_failed({ status: res.status }) };
        return { ok: true as const, intent, signerId };
    }

    if (intent === "copy-link") {
        const res = await api.admin.agreements.requests[":requestId"].signers[":signerId"].link.$get({
            param: { requestId, signerId },
        });
        if (!res.ok) return { ok: false as const, intent, signerId, error: m.library_agreements_err_link_failed({ status: res.status }) };
        const body = (await res.json()) as { data: { url: string } };
        return { ok: true as const, intent, signerId, url: body.data.url };
    }

    return { ok: false as const, intent, error: m.library_agreements_err_api_status({ status: 400 }) };
}
