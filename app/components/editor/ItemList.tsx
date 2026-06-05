import { useState } from "react";

interface ItemListProps {
  items: Array<{ id: string; label: string; type: string }>;
  sectionId: string;
  activeItemId: string | null;
  onSelect: (id: string) => void;
  results: Record<string, Record<string, unknown>>;
  batchMode?: boolean;
  batchSelected?: Record<string, boolean>;
  onBatchToggle?: (id: string) => void;
}

/** Map rating to dot color for the item list */
function ratingDotClass(rating: string): string {
  if (rating === "Satisfactory" || rating === "SAT") return "bg-ih-ok";
  if (rating === "Monitor" || rating === "MON") return "bg-ih-watch";
  if (rating === "Defect" || rating === "DEF") return "bg-ih-bad";
  return "bg-ih-border-strong";
}

export function ItemList({ items, sectionId, activeItemId, onSelect, results, batchMode, batchSelected, onBatchToggle }: ItemListProps) {
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
    <div data-shortcut-scope className="w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto flex flex-col">
      {/* Filter chips */}
      <div className="px-2 py-1.5 flex gap-1 border-b border-ih-border">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2 py-1 rounded text-[11px] font-bold ${
              filter === f.id
                ? "bg-ih-primary-tint text-ih-primary"
                : "text-ih-fg-4 hover:text-ih-fg-2"
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
              onClick={() => {
                if (batchMode && onBatchToggle) {
                  onBatchToggle(item.id);
                } else {
                  onSelect(item.id);
                }
              }}
              className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all flex items-center gap-2 ${
                activeItemId === item.id
                  ? "bg-ih-bg-card shadow-ih-card border-l-[3px] border-ih-primary font-medium"
                  : "text-ih-fg-3 hover:bg-ih-bg-muted"
              }`}
            >
              {batchMode && (
                <span
                  className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                    batchSelected?.[item.id]
                      ? "bg-ih-primary border-ih-primary"
                      : "border-ih-border-strong"
                  }`}
                >
                  {batchSelected?.[item.id] && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              )}
              <span className="text-[10px] text-ih-fg-4 font-mono w-5">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {Boolean(result.rating) && (
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
