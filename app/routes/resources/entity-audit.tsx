/**
 * IA-64 — BFF resource route for the entity change-history disclosure.
 *
 * loader: GET /api/audit/entity/:entityId — tenant-scoped audit trail, newest
 * first. Loaded via useFetcher by <EntityAuditTrail>; renders no UI itself.
 */
import type { Route } from "./+types/entity-audit";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { AuditEntry } from "~/components/audit/EntityAuditTrail";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { entries: [] as AuditEntry[] };
    const entityId = new URL(request.url).searchParams.get("entityId");
    if (!entityId) return { entries: [] as AuditEntry[] };
    const api = createApi(context, { token });
    try {
        const res = await api.audit.entity[":entityId"].$get(
            { param: { entityId }, query: { limit: "20" } },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { entries: [] as AuditEntry[] };
        const json = (await res.json()) as { data?: { entries?: AuditEntry[] } };
        return { entries: json?.data?.entries ?? [] };
    } catch {
        return { entries: [] as AuditEntry[] };
    }
}
