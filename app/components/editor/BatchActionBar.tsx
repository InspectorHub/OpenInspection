import React from "react";
import { Button } from "@core/shared-ui";
import { RatingSegment, type RatingOption } from "../editor-shared/RatingSegment";

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
  // Numbered tiles, coloured per-tenant via getRatingColor — `color` wins over
  // the (unused) tone token on every tile, unconditionally, mirroring the
  // former always-on inline `style={{ background: getRatingColor(...) }}`.
  const batchRatings: RatingOption[] = ratingLevels.map((level, idx) => ({
    value: level.id,
    label: String(idx + 1),
    tone: "neutral",
    color: getRatingColor(level.id),
  }));

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
      <Button variant="link" size="sm" onClick={onSelectAll}>
        Select all
      </Button>
      <Button variant="link" size="sm" onClick={onClear}>
        Clear
      </Button>

      <div className="w-px h-4 bg-ih-border flex-shrink-0" aria-hidden="true" />

      {/* Rating buttons — dynamic per-tenant colour via RatingSegment's
          per-option `color` override (wins over the tone token, applies
          regardless of selection — same pattern as the former inline style). */}
      <RatingSegment
        ratings={batchRatings}
        value={null}
        onChange={onSetRating}
        size="sm"
        ariaLabel="Set rating for selected items"
      />

      {/* Exit batch mode */}
      <Button variant="ghost" size="sm" onClick={onExit} className="ml-auto">
        Exit
      </Button>
    </div>
  );
}
