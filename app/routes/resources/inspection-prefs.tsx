/**
 * Track H — BFF resource route for tenant inspection-editor preferences
 * (C-12). Replaces useInspectionPrefs' raw client fetches against
 * `/api/tenant/inspection-prefs` with the token-relay pattern.
 *
 * No UI — resource route (loader = GET merged prefs, action = PATCH).
 */
import type { Route } from "./+types/inspection-prefs";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { prefs: null };
    const api = createApi(context, { token });
    try {
        const res = await api.inspectionPrefs.index.$get(
            {},
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { prefs: null };
        return { prefs: await res.json() };
    } catch {
        return { prefs: null };
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    if (!token) return { ok: false as const, prefs: null };
    const api = createApi(context, { token });
    const form = await request.formData();
    const raw = String(form.get("patch") ?? "{}");
    let patch: Record<string, unknown>;
    try {
        patch = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return { ok: false as const, prefs: null };
    }
    try {
        const res = await api.inspectionPrefs.index.$patch(
            { json: patch },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { ok: false as const, prefs: null };
        return { ok: true as const, prefs: await res.json() };
    } catch {
        return { ok: false as const, prefs: null };
    }
}
