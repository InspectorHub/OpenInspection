/**
 * The web host's `resources.costItems`: the cost lines over the BFF resource route `/resources/cost-items`
 * (loader = GET `?inspectionId=` answers `{ items, reserveEnabled }`, action = POST an `intent` of `create`,
 * `update` or `delete`).
 *
 * Nothing here throws. A failed, unauthenticated, redirected or malformed read answers no lines and no reserve
 * fields, which is what the route itself answers when it cannot read them. A write answers `{ ok: false }`
 * unless the route answered `{ success: true }`; a landed `create` carries the stored line's id.
 *
 * The write is the form the cost drawer built itself: the same field names, with an unset number or text sent
 * as an empty string (the route reads an empty field as absent).
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { CostItemView, CostItemWrite, CostItemsListing } from "@core/field-ui/data-source-types";

export const COST_ITEMS_ROUTE = "/resources/cost-items";

type CostItems = NonNullable<FieldResources["costItems"]>;

const EMPTY: CostItemsListing = { items: [], reserveEnabled: false };

const num = (value: number | null | undefined): string => (value == null ? "" : String(value));

function writeForm(inspectionId: string, write: CostItemWrite): FormData {
    const fd = new FormData();
    fd.set("intent", write.intent);
    fd.set("inspectionId", inspectionId);
    if (write.intent === "delete") {
        fd.set("itemId", write.itemId);
        return fd;
    }
    const item = write.item;
    if (write.intent === "update") fd.set("itemId", item.id);
    fd.set("system", item.system);
    fd.set("component", item.component);
    fd.set("location", item.location ?? "");
    fd.set("action", item.action);
    fd.set("costMethod", item.costMethod);
    fd.set("quantity", num(item.quantity));
    fd.set("uom", item.uom ?? "");
    fd.set("unitCostCents", num(item.unitCostCents));
    fd.set("lumpSumCents", num(item.lumpSumCents));
    fd.set("eul", num(item.eul));
    fd.set("effAge", num(item.effAge));
    fd.set("rul", num(item.rul));
    fd.set("suggestedRemedy", item.suggestedRemedy ?? "");
    fd.set("bucket", item.bucket);
    fd.set("sortOrder", String(item.sortOrder ?? 0));
    return fd;
}

export function createWebCostItems(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): CostItems {
    return {
        async list(inspectionId: string): Promise<CostItemsListing> {
            try {
                const res = await fetchImpl(`${COST_ITEMS_ROUTE}?inspectionId=${encodeURIComponent(inspectionId)}`, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                });
                if (!res.ok || res.redirected) return EMPTY;
                if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return EMPTY;
                const body = (await res.json().catch(() => null)) as { items?: unknown; reserveEnabled?: unknown } | null;
                if (!Array.isArray(body?.items)) return EMPTY;
                return { items: body.items as CostItemView[], reserveEnabled: body.reserveEnabled === true };
            } catch {
                return EMPTY;
            }
        },
        async save(inspectionId: string, write: CostItemWrite): Promise<CommandResult<{ id?: string }>> {
            try {
                // busy-controls-allow: the caller (CostItemsPanel) guards a create synchronously (one create per draft row); update sets absolute column values and delete removes by id with no error on a missing row, so a repeat of either is harmless
                const res = await fetchImpl(COST_ITEMS_ROUTE, {
                    method: "POST",
                    credentials: "include",
                    body: writeForm(inspectionId, write),
                });
                if (!res.ok || res.redirected) return { ok: false };
                const body = (await res.json().catch(() => null)) as { success?: unknown; id?: unknown } | null;
                if (body === null || typeof body !== "object" || body.success !== true) return { ok: false };
                return { ok: true, data: typeof body.id === "string" ? { id: body.id } : {} };
            } catch {
                return { ok: false };
            }
        },
    };
}
