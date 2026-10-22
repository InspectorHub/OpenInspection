import { useCallback } from "react";
import { useFieldDataSource } from "../../context";
import type { CostItemView } from "../../data-source-types";

/** ASTM E2018 $3,000 immediate-repair materiality line. */
export const THRESHOLD_CENTS = 300_000;

/** What one row adds up to: `quantity * unitCostCents` for the `unit` method, `lumpSumCents` for `lump_sum`. */
export function rowTotalCents(item: Pick<CostItemView, "costMethod" | "quantity" | "unitCostCents" | "lumpSumCents">): number {
  if (item.costMethod === "unit") return (item.quantity ?? 0) * (item.unitCostCents ?? 0);
  return item.lumpSumCents ?? 0;
}

/** A draft row; its `tmp-` id is swapped for the stored id once its create lands. */
export function blankRow(sortOrder: number): CostItemView {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    system: "", component: "", location: "",
    action: "repair", costMethod: "lump_sum",
    quantity: null, uom: null, unitCostCents: null, lumpSumCents: 0,
    eul: null, effAge: null, rul: null,
    suggestedRemedy: "", bucket: "immediate",
    sectionRef: null, photoRef: null, sortOrder,
  };
}

export function isTempId(id: string): boolean {
  return id.startsWith("tmp-");
}

/**
 * One write to the cost lines through the data source's `costItems.save`; never rejects. A host without the
 * resource refuses every write. The caller owns the same-frame guard (a create is not idempotent).
 */
export function useCostItemWrite(inspectionId: string) {
  const costItems = useFieldDataSource().resources.costItems;
  return useCallback(
    async (intent: "create" | "update" | "delete", item: CostItemView): Promise<{ success: boolean; id?: string }> => {
      if (!costItems) return { success: false };
      try {
        const result = await costItems.save(inspectionId, intent === "delete" ? { intent, itemId: item.id } : { intent, item });
        return result.ok ? { success: true, ...(result.data?.id ? { id: result.data.id } : {}) } : { success: false };
      } catch {
        return { success: false };
      }
    },
    [costItems, inspectionId],
  );
}
