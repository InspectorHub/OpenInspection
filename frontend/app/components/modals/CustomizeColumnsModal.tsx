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
      next.has(id) ? next.delete(id) : next.add(id);
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
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-lg w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Customize Columns</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Pick what shows in your inspection list. Saved as the team default.</p>
        </div>

        <div className="p-6 max-h-[400px] overflow-y-auto space-y-2" data-test="customize-columns-list">
          {columns.map((col) => (
            <label
              key={col.id}
              className={`flex items-start gap-3 p-3 rounded-md border transition-all ${
                col.alwaysOn
                  ? "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 cursor-not-allowed"
                  : "bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-500 cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(col.id)}
                disabled={col.alwaysOn}
                onChange={() => !col.alwaysOn && toggle(col.id)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{col.label}</span>
                  {col.alwaysOn && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded">Required</span>}
                  {col.mobileVisible === false && <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded" title="Hidden on mobile">Desktop only</span>}
                </div>
                {col.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{col.description}</p>}
              </div>
            </label>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <button onClick={resetDefaults} className="h-10 px-4 rounded-xl border bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600">Reset to defaults</button>
          <div className="flex-1" />
          <button onClick={onClose} className="h-10 px-4 rounded-xl border bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
