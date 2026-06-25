/**
 * C-12 — BFF resource route for identity switcher.
 *
 * loader: GET /api/identities — list linked identities for the caller
 * action: POST /api/identities/switch — switch active identity (sets cookie, returns redirectUrl)
 */
import type { Route } from "./+types/identities";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { identities: [] as unknown[] };
    const api = createApi(context, { token });
    try {
        const res = await api.identity.index.$get(
            {},
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { identities: [] as unknown[] };
        const json = await res.json() as { data?: { identities?: unknown[] } };
        return { identities: json?.data?.identities ?? [] };
    } catch {
        return { identities: [] as unknown[] };
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    if (!token) return { ok: false as const, redirectUrl: null };
    const api = createApi(context, { token });
    const form = await request.formData();
    const linkedUserId = String(form.get("linkedUserId") ?? "");
    if (!linkedUserId) return { ok: false as const, redirectUrl: null };
    try {
        const res = await api.identity.switch.$post(
            { json: { linkedUserId } },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { ok: false as const, redirectUrl: null };
        const json = await res.json() as { data?: { redirectUrl?: string } };
        return { ok: true as const, redirectUrl: json?.data?.redirectUrl ?? "/inspections" };
    } catch {
        return { ok: false as const, redirectUrl: null };
    }
}
