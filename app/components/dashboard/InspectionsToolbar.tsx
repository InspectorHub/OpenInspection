import type { RefObject } from "react";
import { Button, Icon } from "@core/shared-ui";

interface InspectionsToolbarProps {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  onOpenFilters: () => void;
  onToggleColumns: () => void;
  columnsBtnRef: RefObject<HTMLButtonElement>;
}

/**
 * Table toolbar strip — list-scoped controls (search + filters + columns).
 * Split out of the inspections page header per the DS two-layer actions
 * convention: the header holds only page-level actions (Export / New
 * Inspection), while these list controls sit directly above the list. Wraps on
 * narrow screens (search takes the full row, buttons drop below).
 */
export function InspectionsToolbar({
  searchQuery,
  setSearchQuery,
  onOpenFilters,
  onToggleColumns,
  columnsBtnRef,
}: InspectionsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px] sm:flex-none">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="h-8 w-full sm:w-56 pl-8 pr-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-2 focus:ring-2 focus:ring-ih-primary/30 focus:border-ih-primary outline-none placeholder:text-ih-fg-4"
        />
        <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ih-fg-4" />
      </div>
      <Button variant="secondary" size="sm" icon={<Icon name="filter" size={14} />} onClick={onOpenFilters}>
        Filters
      </Button>
      {/* onMouseDown stopPropagation excludes the trigger from the Popover's
          click-outside handler so a click toggles cleanly (no close-then-reopen).
          columnsBtnRef anchors the ColumnsPopover to this button. */}
      <Button ref={columnsBtnRef} variant="secondary" size="sm" icon={<Icon name="panel" size={14} />}
        onMouseDown={(e) => e.stopPropagation()} onClick={onToggleColumns}>
        Columns
      </Button>
    </div>
  );
}
