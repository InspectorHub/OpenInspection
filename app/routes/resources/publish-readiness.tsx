/**
 * Track H — BFF resource route for the publish pre-flight check (C-12).
 * The editor's publish button needs a FRESH readiness verdict at click time
 * (loader data could be minutes stale), so this stays an on-demand call —
 * but through the token relay instead of a raw client fetch on /api.
 *
 * GET /resources/publish-readiness?id=<inspectionId>
 */
import type { Route } from "./+types/publish-readiness";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!token || !id) return { readiness: null };
    const api = createApi(context, { token });
    try {
        const res = await api.inspections[":id"]["publish-readiness"].$get(
            { param: { id } },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { readiness: null };
        return { readiness: await res.json() };
    } catch {
        return { readiness: null };
    }
}
