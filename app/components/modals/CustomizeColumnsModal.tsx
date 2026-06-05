import { useState, useEffect } from "react";

export interface ColumnDef {
  id: string;
  label: string;
  description?: string;
  defaultOn: boolean;
  alwaysOn?: boolean;
  mobileVisible?: boolean;
}

interface CustomizeColumnsModalProps {
  open: boolean;
  onClose: () => void;
  columns: ColumnDef[];
  onChange: (selected: string[]) => void;
}

export function CustomizeColumnsModal({ open, onClose, columns, onChange }: CustomizeColumnsModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(columns.filter((c) => c.defaultOn || c.alwaysOn).map((c) => c.id))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set(columns.filter((c) => c.defaultOn || c.alwaysOn).map((c) => c.id)));
    }
  }, [open, columns]);

  if (!open) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function resetDefaults() {
    setSelected(new Set(columns.filter((c) => c.defaultOn || c.alwaysOn).map((c) => c.id)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      onChange(Array.from(selected));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.7)] flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-lg w-full bg-ih-bg-card rounded-xl shadow-ih-popover" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-ih-border">
          <h2 className="text-xl font-bold text-ih-fg-1">Customize Columns</h2>
          <p className="text-xs text-ih-fg-3 mt-1">Pick what shows in your inspection list. Saved as the team default.</p>
        </div>

        <div className="p-6 max-h-[400px] overflow-y-auto space-y-2" data-test="customize-columns-list">
          {columns.map((col) => (
            <label
              key={col.id}
              className={`flex items-start gap-3 p-3 rounded-md border transition-all ${
                col.alwaysOn
                  ? "bg-ih-bg-muted border-ih-border cursor-not-allowed"
                  : "bg-ih-bg-card border-ih-border hover:border-ih-primary cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(col.id)}
                disabled={col.alwaysOn}
                onChange={() => !col.alwaysOn && toggle(col.id)}
                className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:shadow-ih-focus disabled:opacity-50"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ih-fg-1">{col.label}</span>
                  {col.alwaysOn && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 bg-ih-bg-muted px-1.5 py-0.5 rounded">Required</span>}
                  {col.mobileVisible === false && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 bg-ih-bg-muted px-1.5 py-0.5 rounded" title="Hidden on mobile">Desktop only</span>}
                </div>
                {col.description && <p className="text-xs text-ih-fg-3 mt-0.5">{col.description}</p>}
              </div>
            </label>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-ih-border flex items-center gap-2">
          <button onClick={resetDefaults} className="h-10 px-4 rounded-xl border bg-ih-bg-card text-ih-fg-2 border-ih-border text-sm font-semibold hover:bg-ih-bg-muted">Reset to defaults</button>
          <div className="flex-1" />
          <button onClick={onClose} className="h-10 px-4 rounded-xl border bg-ih-bg-card text-ih-fg-2 border-ih-border text-sm font-semibold hover:bg-ih-bg-muted">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="h-10 px-4 rounded-xl bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary-600 disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
