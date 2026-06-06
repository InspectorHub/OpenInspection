/**
 * C-12 — BFF resource route for CommandPalette recent inspections.
 *
 * loader: GET /api/inspections?limit=10 — returns the 10 most recent inspections
 */
import type { Route } from "./+types/recent-inspections";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { inspections: [] as unknown[] };
    const api = createApi(context, { token });
    try {
        const res = await api.inspections.index.$get(
            { query: { limit: "10" } },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { inspections: [] as unknown[] };
        const json = await res.json() as { data?: unknown[] };
        return { inspections: json?.data ?? [] };
    } catch {
        return { inspections: [] as unknown[] };
    }
}
