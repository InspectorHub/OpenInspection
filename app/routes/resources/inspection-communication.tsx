/**
 * BFF resource route for the hub's Communication section (plan A1.2/A1.3).
 *
 * loader: GET /api/inspections/:id/communication — the two never-interleaved
 *         arrays (messages / deliveries). Loaded via useFetcher on expand and
 *         re-loaded by the visibility-gated poll.
 * action: POST /api/inspections/:id/messages — an inspector reply into a named
 *         contact's thread. Goes through here rather than a browser fetch so
 *         the token-relay BFF stays the one authenticated path.
 */
import type { Route } from "./+types/inspection-communication";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { DeliveryRow, MessageRow, ReportLinkRow } from "~/lib/communication-view";

export interface CommunicationPayload {
    messages: MessageRow[];
    deliveries: DeliveryRow[];
    /** OI #271 — report delivery per recipient; see <ReportDeliveryList>. */
    reportLinks: ReportLinkRow[];
}

const EMPTY: CommunicationPayload = { messages: [], deliveries: [], reportLinks: [] };

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return EMPTY;
    const url = new URL(request.url);
    const inspectionId = url.searchParams.get("inspectionId");
    const markRead = url.searchParams.get("markRead") === "1";
    if (!inspectionId) return EMPTY;
    const api = createApi(context, { token });
    try {
        const res = await api.inspections[":id"].communication.$get(
            { param: { id: inspectionId }, query: markRead ? { markRead: "1" } : {} },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return EMPTY;
        const json = (await res.json()) as { data?: CommunicationPayload };
        return json?.data ?? EMPTY;
    } catch {
        return EMPTY;
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    if (!token) return { ok: false as const, error: "unauthorized" };
    const form = await request.formData();
    const inspectionId = String(form.get("inspectionId") ?? "");
    const body = String(form.get("body") ?? "").trim();
    const contactId = String(form.get("contactId") ?? "");
    if (!inspectionId || !body) return { ok: false as const, error: "invalid" };
    const api = createApi(context, { token });
    try {
        const res = await api.inspectorMessages[":inspectionId"].messages.$post(
            {
                param: { inspectionId },
                json: { body, ...(contactId ? { contactId } : {}) },
            },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { ok: false as const, error: `send_${res.status}` };
        return { ok: true as const };
    } catch {
        return { ok: false as const, error: "send_network" };
    }
}
