import React from "react";

interface BatchActionBarProps {
  count: number;
  ratingLevels: { id: string }[];
  getRatingColor: (id: string) => string;
  onSelectAll: () => void;
  onClear: () => void;
  onSetRating: (levelId: string) => void;
  onExit: () => void;
}

/**
 * Consolidated batch-mode action bar (D5).
 * Renders a full-width bottom bar when the user has one or more items
 * selected in batch mode. Contains: selected count, Select all / Clear,
 * rating buttons (up to 5 levels), and an Exit button.
 *
 * The per-rating background colour comes from getRatingColor(level.id) which
 * returns a dynamic CSS colour string derived from tenant config — this is the
 * only inline style in the component and is intentional (dynamic data, not a
 * static token violation).
 */
export function BatchActionBar({
  count,
  ratingLevels,
  getRatingColor,
  onSelectAll,
  onClear,
  onSetRating,
  onExit,
}: BatchActionBarProps) {
  return (
    <div className="flex items-center gap-2 bg-ih-bg-card border-t border-ih-border px-4 py-2">
      {/* Selected count */}
      <span
        data-testid="batch-count"
        className="text-[11px] font-bold text-ih-fg-2 whitespace-nowrap"
      >
        {count} selected
      </span>

      <div className="w-px h-4 bg-ih-border flex-shrink-0" aria-hidden="true" />

      {/* Select all / Clear */}
      <button
        type="button"
        onClick={onSelectAll}
        className="px-2 py-0.5 rounded text-[11px] font-bold text-ih-primary hover:bg-ih-primary-tint"
      >
        Select all
      </button>
      <button
        type="button"
        onClick={onClear}
        className="px-2 py-0.5 rounded text-[11px] font-bold text-ih-fg-3 hover:text-ih-fg-2"
      >
        Clear
      </button>

      <div className="w-px h-4 bg-ih-border flex-shrink-0" aria-hidden="true" />

      {/* Rating buttons */}
      <div className="flex gap-1">
        {ratingLevels.map((level, idx) => (
          <button
            key={level.id}
            type="button"
            data-rating-id={level.id}
            onClick={() => onSetRating(level.id)}
            className="w-7 h-7 rounded text-[10px] font-bold"
            style={{ background: getRatingColor(level.id), color: "white" }}
          >
            {idx + 1}
          </button>
        ))}
      </div>

      {/* Exit batch mode */}
      <button
        type="button"
        onClick={onExit}
        className="ml-auto text-[11px] text-ih-fg-3 hover:text-ih-fg-1"
      >
        Exit
      </button>
    </div>
  );
}
