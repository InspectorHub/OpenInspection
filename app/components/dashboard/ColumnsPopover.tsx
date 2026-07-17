import type React from "react";
import { COLUMN_REGISTRY, ALWAYS_ON } from "~/lib/dashboard-schema";
import { Button, Popover } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface ColumnsPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The "Columns" toolbar button the panel anchors beneath. */
  anchorRef: React.RefObject<HTMLElement | null>;
  isColumnVisible: (id: string) => boolean;
  toggleColumn: (id: string) => void;
  resetColumns: () => void;
}

/**
 * Column-visibility toggle list. A lightweight, in-context choice anchored to
 * its trigger button — so a Popover, not a Modal (design system §4). Toggles
 * apply immediately (each onChange persists straight through toggleColumn);
 * there is no Apply/Cancel step. Dismissal is click-outside or Esc, handled by
 * the Popover primitive.
 */
export function ColumnsPopover({
  open,
  onClose,
  anchorRef,
  isColumnVisible,
  toggleColumn,
  resetColumns,
}: ColumnsPopoverProps) {
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} align="right">
      <div className="w-64 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-bold text-ih-fg-1">{m.dashboard_columns_title()}</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg leading-none" aria-label={m.common_close()}>
            &times;
          </button>
        </div>
        <div className="space-y-2">
          {COLUMN_REGISTRY.map((col) => (
            <label key={col.id} className="flex items-center gap-3 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isColumnVisible(col.id)}
                disabled={ALWAYS_ON.has(col.id)}
                onChange={() => toggleColumn(col.id)}
                className="accent-ih-primary"
              />
              <span className="text-[13px] text-ih-fg-2">
                {col.label}
                {ALWAYS_ON.has(col.id) && <span className="ml-1 text-[10px] text-ih-fg-4">{m.dashboard_columns_required()}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={resetColumns}>
            {m.dashboard_columns_reset()}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
