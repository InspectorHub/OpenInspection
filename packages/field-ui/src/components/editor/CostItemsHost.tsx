import { useEffect, useState } from "react";
import { Drawer } from "@core/shared-ui";
import { CostItemsPanel } from "./CostItemsPanel";
import { useFieldDataSource } from "../../context";
import type { CostItemsListing } from "../../data-source-types";
import { m } from "../../i18n";

const EMPTY: CostItemsListing = { items: [], reserveEnabled: false };

/**
 * Commercial PCA Phase C Task 13b — thin host for `CostItemsPanel`.
 *
 * `CostItemsPanel` itself is pure props-in / self-managed-mutations (see its
 * own header comment); this wrapper supplies the initial `items` +
 * `reserveEnabled` by reading the data source's `costItems.list` on open.
 * Kept as its own small drawer (same shape as `UnitsManager`'s host slot in
 * `inspection-edit.tsx`) rather than threading two more fields through the
 * inspection-edit loader — the loader + its ~2200-line route are already
 * large, and cost items are read-after-open here, not needed on first paint.
 *
 * Final-review fix: `data` used to be seeded to `EMPTY` and `<CostItemsPanel>`
 * rendered unconditionally — but `Panel` does `useState(items)` once at mount
 * and `Drawer` unmounts/remounts it on every open/close, so the FIRST open of
 * an inspection that already has cost items mounted the Panel with `items=[]`
 * while the read below was still in flight, and the Panel never re-synced
 * once it resolved (empty panel + hidden reserve fields; risk of duplicate
 * rows if the user re-added items that already existed server-side). Fixed
 * by keeping `data` as `null` until the read settles and NOT rendering the
 * Panel until then, so its `useState(items)` captures the real payload at
 * mount. A failed read still resolves to `EMPTY` (loaded, zero items) rather
 * than leaving the drawer stuck loading forever.
 */
export function CostItemsHost({
  open, onClose, inspectionId,
}: {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
}) {
  const costItems = useFieldDataSource().resources.costItems;
  const [data, setData] = useState<CostItemsListing | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setData(null);
    // A host without the cost lines answers an empty, loaded panel (which then refuses every write).
    void (costItems?.list(inspectionId) ?? Promise.resolve(EMPTY))
      .then((listing) => { if (!cancelled) setData(listing); })
      .catch(() => { if (!cancelled) setData(EMPTY); });
    return () => { cancelled = true; };
  }, [open, inspectionId, costItems]);

  return (
    <Drawer open={open} onClose={onClose} title={m.editor_cost_items_title()} wide>
      {data === null ? (
        <p className="text-[12px] text-ih-fg-3" aria-busy="true">{m.common_loading()}</p>
      ) : (
        <CostItemsPanel inspectionId={inspectionId} items={data.items} reserveEnabled={data.reserveEnabled} />
      )}
    </Drawer>
  );
}
