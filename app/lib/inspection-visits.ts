/* ------------------------------------------------------------------ */
/*  Inspection-hub VISIT read + write helpers (pure — no React)        */
/* ------------------------------------------------------------------ */

/**
 * `inspection_events` — the visits that make up a job. A radon test is a
 * drop-off and a pickup two days apart; the table, its CRUD API and an
 * automation trigger per transition all existed with no frontend, which is why
 * production holds zero rows.
 *
 * Its own module rather than inline in the route: `inspector-portal.tsx` sits
 * against its file-size ceiling, which is the same reason
 * `inspection-order-actions.ts` exists beside it.
 */

import type { Api } from "~/lib/api-client.server";
import { toActionResult } from "~/lib/inspector-portal-actions";
import type {
    VisitRowData,
    VisitTypeOption,
} from "~/components/inspector-portal/VisitsCard";
import { m } from "~/paraglide/messages";

/** A catalogue row as far as visit proposal is concerned. */
export interface VisitProposalService {
    id: string;
    defaultEventTypeSlugs?: string[] | null;
}

export interface VisitsPayload {
    visits: VisitRowData[];
    visitTypes: VisitTypeOption[];
    suggestedTypeIds: string[];
}

/**
 * The visits on this inspection, the tenant's visit-type catalogue, and which
 * of those types the order's own services imply.
 *
 * Everything hangs off `api.events` — the EventsApi client, mounted at `/api`.
 * NOT `api.inspections` and NOT a bare `api["event-types"]`: `api` is a plain
 * record of named clients, so an unknown key is `undefined` and, with the
 * optional chaining this file uses for graceful degradation, resolves to an
 * empty list SILENTLY. The visible symptom is a visit row titled with a raw
 * UUID, because the name lookup had no types to look in.
 *
 * Best-effort throughout, like every other secondary fetch on the hub loader:
 * the card degrades to an empty list rather than 500-ing a page whose primary
 * payload already arrived.
 */
export async function loadVisits(
    api: Api,
    inspectionId: string,
    bookedServiceIds: Set<string>,
    catalogRows: VisitProposalService[],
): Promise<VisitsPayload> {
    const visitsGet = api.events?.inspections?.[":inspectionId"]?.events?.$get as unknown as
        | ((args: { param: { inspectionId: string } }) => Promise<Response>)
        | undefined;
    const visitsRes = visitsGet
        ? await visitsGet({ param: { inspectionId } }).catch(() => null)
        : null;
    const visits: VisitRowData[] =
        visitsRes && visitsRes.ok
            ? (((await visitsRes.json()) as { data?: VisitRowData[] }).data ?? [])
            : [];

    const typesGet = api.events?.["event-types"]?.$get as unknown as
        | ((args?: unknown) => Promise<Response>)
        | undefined;
    const typesRes = typesGet ? await typesGet({}).catch(() => null) : null;
    const visitTypes: VisitTypeOption[] =
        typesRes && typesRes.ok
            ? (((await typesRes.json()) as { data?: VisitTypeOption[] }).data ?? [])
            : [];

    // Which visit types THIS order's services imply. Resolved from slugs, and a
    // slug with no surviving event type is silently dropped — the same rule
    // `ServiceService.proposeEventsForService` applies server-side, so tidying
    // up the event-type list shortens the proposal instead of breaking the page.
    const suggestedSlugs = new Set(
        catalogRows
            .filter((s) => bookedServiceIds.has(s.id))
            .flatMap((s) => s.defaultEventTypeSlugs ?? []),
    );
    const suggestedTypeIds = visitTypes
        .filter((t) => suggestedSlugs.has(t.slug))
        .map((t) => t.id);

    return { visits, visitTypes, suggestedTypeIds };
}

export async function handleVisitAdd(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "visit-add"; error: string | undefined }> {
    const addVisit = api.events?.inspections?.[":inspectionId"]?.events?.$post as unknown as
        | ((args: {
            param: { inspectionId: string };
            json: Record<string, unknown>;
        }) => Promise<Response>)
        | undefined;
    if (!addVisit) {
        return { ok: false, intent: "visit-add", error: m.inspections_hub_error_visit_add() };
    }
    const res = await addVisit({
        param: { inspectionId },
        json: {
            eventTypeId: String(formData.get("eventTypeId") ?? ""),
            scheduledAt: String(formData.get("scheduledAt") ?? ""),
            durationMin: Number(formData.get("durationMin") ?? 30),
        },
    });
    return toActionResult(res, "visit-add", m.inspections_hub_error_visit_add());
}

export async function handleVisitStatus(
    api: Api,
    formData: FormData,
): Promise<{ ok: boolean; intent: "visit-status"; error: string | undefined }> {
    const setStatus = api.events?.events?.[":id"]?.$put as unknown as
        | ((args: { param: { id: string }; json: { status: string } }) => Promise<Response>)
        | undefined;
    if (!setStatus) {
        return { ok: false, intent: "visit-status", error: m.inspections_hub_error_visit_status() };
    }
    const res = await setStatus({
        param: { id: String(formData.get("eventId") ?? "") },
        json: { status: String(formData.get("status") ?? "") },
    });
    return toActionResult(res, "visit-status", m.inspections_hub_error_visit_status());
}
