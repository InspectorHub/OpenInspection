import type { CostItemView } from "~/components/portal/sections/report/types";

/** One write to the cost items relay: the panel's create, update and delete. */
export async function submitCostItem(
  inspectionId: string,
  intent: "create" | "update" | "delete",
  item: CostItemView,
): Promise<{ success: boolean; id?: string }> {
  const fd = new FormData();
  fd.set("intent", intent);
  fd.set("inspectionId", inspectionId);
  if (intent !== "create") fd.set("itemId", item.id);
  if (intent !== "delete") {
    fd.set("system", item.system);
    fd.set("component", item.component);
    fd.set("location", item.location ?? "");
    fd.set("action", item.action);
    fd.set("costMethod", item.costMethod);
    fd.set("quantity", item.quantity == null ? "" : String(item.quantity));
    fd.set("uom", item.uom ?? "");
    fd.set("unitCostCents", item.unitCostCents == null ? "" : String(item.unitCostCents));
    fd.set("lumpSumCents", item.lumpSumCents == null ? "" : String(item.lumpSumCents));
    fd.set("eul", item.eul == null ? "" : String(item.eul));
    fd.set("effAge", item.effAge == null ? "" : String(item.effAge));
    fd.set("rul", item.rul == null ? "" : String(item.rul));
    fd.set("suggestedRemedy", item.suggestedRemedy ?? "");
    fd.set("bucket", item.bucket);
    fd.set("sortOrder", String(item.sortOrder ?? 0));
  }
  try {
    // busy-controls-allow: update sets absolute column values and delete removes by id with no error on a missing row (CostItemService.update/remove), so a repeat is harmless; the same fetch also carries intent=create, which is not idempotent and is guarded at its only call sites (addRow behind addLatch, and a temp row's follow-up create behind saving[id])
    const res = await fetch("/resources/cost-items", { method: "POST", credentials: "include", body: fd });
    if (!res.ok) return { success: false };
    return (await res.json()) as { success: boolean; id?: string };
  } catch {
    return { success: false };
  }
}
