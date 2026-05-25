import { useMemo } from "react";

interface UnitNode {
  id: string;
  name: string;
  parentId: string | null;
}

interface UnitTreeProps {
  nodes: UnitNode[];
  selectedUnitId?: string | null;
  onSelectUnit?: (id: string) => void;
  onAddUnit?: (parentId: string | null, type: "building" | "floor" | "unit") => void;
  allowEnable?: boolean;
}

export function UnitTree({ nodes, selectedUnitId, onSelectUnit, onAddUnit, allowEnable }: UnitTreeProps) {
  const roots = useMemo(() => nodes.filter((n) => !n.parentId), [nodes]);
  const childrenOf = (parentId: string) => nodes.filter((n) => n.parentId === parentId);
  const hasUnits = nodes.length > 0;

  if (!hasUnits && !allowEnable) return null;

  return (
    <aside className="w-56 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 overflow-y-auto" aria-label="Unit hierarchy">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Units</h3>
        <button
          className="px-2 h-6 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => onAddUnit?.(null, "building")}
          title="Add building"
        >+</button>
      </div>
      <ul className="space-y-1 text-sm">
        {roots.map((b) => (
          <li key={b.id}>
            <div className={`flex items-center gap-1 ${selectedUnitId === b.id ? "bg-indigo-100 dark:bg-indigo-900/30 rounded" : ""}`}>
              <button className="flex-1 text-left px-2 py-1 font-medium" onClick={() => onSelectUnit?.(b.id)}>{b.name}</button>
              <button className="text-slate-400 hover:text-indigo-600 px-1" onClick={() => onAddUnit?.(b.id, "floor")} title="Add floor">+</button>
            </div>
            <ul className="ml-3 mt-1 space-y-1">
              {childrenOf(b.id).map((f) => (
                <li key={f.id}>
                  <div className={`flex items-center gap-1 ${selectedUnitId === f.id ? "bg-indigo-100 dark:bg-indigo-900/30 rounded" : ""}`}>
                    <button className="flex-1 text-left px-2 py-1" onClick={() => onSelectUnit?.(f.id)}>{f.name}</button>
                    <button className="text-slate-400 hover:text-indigo-600 px-1" onClick={() => onAddUnit?.(f.id, "unit")} title="Add unit">+</button>
                  </div>
                  <ul className="ml-3 mt-1 space-y-1">
                    {childrenOf(f.id).map((u) => (
                      <li key={u.id}>
                        <button
                          className={`text-left px-2 py-1 w-full text-slate-700 dark:text-slate-300 ${selectedUnitId === u.id ? "bg-indigo-100 dark:bg-indigo-900/30 rounded" : ""}`}
                          onClick={() => onSelectUnit?.(u.id)}
                        >{u.name}</button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {!hasUnits && allowEnable && (
        <div className="mt-4">
          <button
            className="px-3 h-8 rounded-md bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 text-xs font-bold text-indigo-700 dark:text-indigo-300 w-full hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
            onClick={() => onAddUnit?.(null, "building")}
          >
            + Add first building
          </button>
          <p className="text-[10px] text-slate-400 mt-1 leading-snug">
            Switches this inspection to multi-unit mode.
          </p>
        </div>
      )}
    </aside>
  );
}
