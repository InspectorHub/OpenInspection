import { useState } from "react";

interface ItemListProps {
  items: Array<{ id: string; label: string; type: string }>;
  sectionId: string;
  activeItemId: string | null;
  onSelect: (id: string) => void;
  results: Record<string, any>;
}

/** Map rating to dot color for the item list */
function ratingDotClass(rating: string): string {
  if (rating === "Satisfactory" || rating === "SAT") return "bg-emerald-500";
  if (rating === "Monitor" || rating === "MON") return "bg-amber-500";
  if (rating === "Defect" || rating === "DEF") return "bg-rose-500";
  return "bg-slate-300";
}

export function ItemList({ items, sectionId, activeItemId, onSelect, results }: ItemListProps) {
  const [filter, setFilter] = useState("all");

  const filters = [
    { id: "all", label: "All" },
    { id: "unrated", label: "Unrated" },
    { id: "issues", label: "Issues" },
    { id: "flagged", label: "Flagged" },
  ];

  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    const r = results[`_default:${sectionId}:${item.id}`] || results[item.id] || {};
    if (filter === "unrated") return !r.rating;
    if (filter === "issues") return r.rating === "DEF" || r.rating === "MON" || r.rating === "Defect" || r.rating === "Monitor";
    return true;
  });

  return (
    <div className="w-[280px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto flex flex-col">
      {/* Filter chips */}
      <div className="px-2 py-1.5 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2 py-1 rounded text-[11px] font-bold ${
              filter === f.id
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {filteredItems.map((item, idx) => {
          const result = results[`_default:${sectionId}:${item.id}`] || results[item.id] || {};
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all flex items-center gap-2 ${
                activeItemId === item.id
                  ? "bg-white dark:bg-slate-800 shadow-sm border-l-[3px] border-indigo-600 font-medium"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              }`}
            >
              <span className="text-[10px] text-slate-400 font-mono w-5">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {result.rating && (
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${ratingDotClass(result.rating as string)}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
