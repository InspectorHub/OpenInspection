/* ------------------------------------------------------------------ */
/*  Inspection-hub ORDER action helpers (pure — no React)             */
/* ------------------------------------------------------------------ */

/**
 * IA-87 + the settings merge: the facts about the *order* — when it happens,
 * who runs it, what was sold, what it costs, what has to happen before the
 * client sees the report — used to be editable only from a settings sheet
 * inside the REPORT editor, or (for service lines) not at all after creation.
 * These handlers are the hub's write face for them.
 *
 * They live beside the People handlers in `inspector-portal-actions.ts` in
 * spirit, in their own module in fact, because that one is already at its
 * file-size ceiling.
 */

import type { Api } from "~/lib/api-client.server";
import { toActionResult } from "~/lib/inspector-portal-actions";
import { m } from "~/paraglide/messages";

/** Fields of `UpdateInspectionSchema` the hub's order cards are allowed to write. */
const ORDER_FIELDS = [
    "date",
    "inspectorId",
    "price",
    "closingDate",
    "referenceNumber",
    "referralSource",
    "referredByContactId",
    "paymentRequired",
    "agreementRequired",
] as const;

type OrderField = (typeof ORDER_FIELDS)[number];

/**
 * Keep only the order fields out of a posted payload.
 *
 * The route relays this straight to `PATCH /api/inspections/:id`, whose Zod
 * schema also accepts `status`, `templateId`, `coverPhotoId` and the property
 * facts. Those have their own surfaces with their own rules — the publish
 * lifecycle owns `status`, the editor owns the template — so an allow-list
 * here keeps one modal's payload from quietly becoming a general-purpose
 * inspection PATCH. Exported for the test that pins the list.
 */
export function pickOrderFields(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of ORDER_FIELDS) {
        // `null` is meaningful (clear the value); only absence is skipped.
        if (key in payload) out[key as OrderField] = payload[key];
    }
    return out;
}

/**
 * `save-order` — one intent behind every order-fact editor on the hub (the
 * schedule modal, the order-details modal, the base-price modal, and the two
 * delivery-gate switches). They all write the same row through the same PATCH,
 * so one intent beats four that differ only in which keys they carry.
 */
export async function handleSaveOrder(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "save-order"; error: string | undefined }> {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(String(formData.get("payload") ?? "{}")) as Record<string, unknown>;
    } catch {
        return { ok: false, intent: "save-order", error: m.inspections_hub_error_save_order() };
    }
    const res = await api.inspections[":id"].$patch({
        param: { id: inspectionId },
        json: pickOrderFields(parsed),
    });
    return toActionResult(res, "save-order", m.inspections_hub_error_save_order());
}

/** `service-add` — book a catalog service onto this inspection (IA-87). */
export async function handleServiceAdd(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "service-add"; error: string | undefined }> {
    const serviceId = String(formData.get("serviceId") ?? "").trim();
    if (!serviceId) {
        return { ok: false, intent: "service-add", error: m.inspections_hub_error_service_add() };
    }
    const override = parseCents(formData.get("priceOverrideCents"));
    const res = await api.inspections[":id"].services.$post({
        param: { id: inspectionId },
        json: { serviceId, ...(override === undefined ? {} : { priceOverrideCents: override }) },
    });
    return toActionResult(res, "service-add", m.inspections_hub_error_service_add());
}

/** `service-price` — reprice one booked line; an empty value reverts to the catalog price. */
export async function handleServicePrice(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "service-price"; error: string | undefined }> {
    const lineId = String(formData.get("lineId") ?? "").trim();
    if (!lineId) {
        return { ok: false, intent: "service-price", error: m.inspections_hub_error_service_price() };
    }
    const override = parseCents(formData.get("priceOverrideCents"));
    const res = await api.inspections[":id"].services[":lineId"].$patch({
        param: { id: inspectionId, lineId },
        json: { priceOverrideCents: override ?? null },
    });
    return toActionResult(res, "service-price", m.inspections_hub_error_service_price());
}

/** `service-remove` — drop a booked line. Leaves the tenant catalog alone. */
export async function handleServiceRemove(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "service-remove"; error: string | undefined }> {
    const lineId = String(formData.get("lineId") ?? "").trim();
    if (!lineId) {
        return { ok: false, intent: "service-remove", error: m.inspections_hub_error_service_remove() };
    }
    const res = await api.inspections[":id"].services[":lineId"].$delete({
        param: { id: inspectionId, lineId },
    });
    return toActionResult(res, "service-remove", m.inspections_hub_error_service_remove());
}

/**
 * `unlock-report` — release the order-wide gate for this inspection.
 *
 * The reason is required here as well as at the API. Failing in the browser
 * means the operator is told by the field they are looking at rather than by a
 * round trip, and it keeps the API from being the only thing standing between a
 * blank reason and the audit log.
 */
export async function handleUnlockReport(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "unlock-report"; error: string | undefined }> {
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) {
        return { ok: false, intent: "unlock-report", error: m.hub_gate_unlock_reason_required() };
    }
    const res = await api.inspections[":id"]["unlock-report"].$post({
        param: { id: inspectionId },
        json: { reason },
    });
    return toActionResult(res, "unlock-report", m.hub_gate_unlock_failed());
}

/** `relock-report` — put the gate back. No reason needed to restore a default. */
export async function handleRelockReport(
    api: Api,
    inspectionId: string,
): Promise<{ ok: boolean; intent: "relock-report"; error: string | undefined }> {
    const res = await api.inspections[":id"]["relock-report"].$post({
        param: { id: inspectionId },
    });
    return toActionResult(res, "relock-report", m.hub_gate_relock_failed());
}

/**
 * `report-delete` — destroy one deliverable and its document.
 *
 * The refusals (primary, published) are NOT re-checked here. They are enforced
 * server-side and surfaced through the payload's `canDelete`, so this handler
 * relays whatever the API says: a second copy of the rule in the browser is a
 * copy that can disagree with the one that actually decides.
 */
export async function handleReportDelete(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "report-delete"; error: string | undefined }> {
    const reportId = String(formData.get("reportId") ?? "").trim();
    if (!reportId) {
        return { ok: false, intent: "report-delete", error: m.inspections_hub_error_report_delete() };
    }
    const res = await api.inspections[":id"].reports[":reportId"].$delete({
        param: { id: inspectionId, reportId },
    });
    return toActionResult(res, "report-delete", m.inspections_hub_error_report_delete());
}

/**
 * A money field that was left blank means "no override", which is a different
 * thing from zero — a free line is a real thing an operator may want. `''` and
 * a missing field both read as absent; anything unparseable does too, rather
 * than silently billing NaN.
 */
function parseCents(raw: FormDataEntryValue | null): number | undefined {
    if (raw === null) return undefined;
    const text = String(raw).trim();
    if (text === "") return undefined;
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}
