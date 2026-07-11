import { useEffect, useState } from "react";
import { Drawer } from "@core/shared-ui";
import { CostItemsPanel } from "./CostItemsPanel";
import type { CostItemView } from "~/components/portal/sections/report/types";

interface CostItemsData {
  items: CostItemView[];
  reserveEnabled: boolean;
}

const EMPTY: CostItemsData = { items: [], reserveEnabled: false };

/**
 * Commercial PCA Phase C Task 13b — thin host for `CostItemsPanel`.
 *
 * `CostItemsPanel` itself is pure props-in / self-managed-mutations (see its
 * own header comment); this wrapper supplies the initial `items` +
 * `reserveEnabled` by self-loading `/resources/cost-items` on open, mirroring
 * `RepairItemsPanel.tsx`'s mount-time `fetch(..., { credentials: "include" })`.
 * Kept as its own small drawer (same shape as `UnitsManager`'s host slot in
 * `inspection-edit.tsx`) rather than threading two more fields through the
 * inspection-edit loader — the loader + its ~2200-line route are already
 * large, and cost items are read-after-open here, not needed on first paint.
 */
export function CostItemsHost({
  open, onClose, inspectionId,
}: {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
}) {
  const [data, setData] = useState<CostItemsData>(EMPTY);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/resources/cost-items?inspectionId=${encodeURIComponent(inspectionId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((b) => { if (!cancelled) setData(b as CostItemsData); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, inspectionId]);

  return (
    <Drawer open={open} onClose={onClose} title="Cost Items" wide>
      <CostItemsPanel inspectionId={inspectionId} items={data.items} reserveEnabled={data.reserveEnabled} />
    </Drawer>
  );
}
