import { COLUMN_REGISTRY, ALWAYS_ON } from "~/lib/dashboard-schema";
import { Button } from "@core/shared-ui";

interface ColumnsModalProps {
  onClose: () => void;
  isColumnVisible: (id: string) => boolean;
  toggleColumn: (id: string) => void;
  resetColumns: () => void;
}

export function ColumnsModal({
  onClose,
  isColumnVisible,
  toggleColumn,
  resetColumns,
}: ColumnsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-ih-bg-card rounded-xl shadow-ih-popover p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-ih-fg-1">Customize Columns</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg">&times;</button>
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
                {ALWAYS_ON.has(col.id) && <span className="ml-1 text-[10px] text-ih-fg-4">(required)</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" size="sm" onClick={resetColumns}>
            Reset to defaults
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
