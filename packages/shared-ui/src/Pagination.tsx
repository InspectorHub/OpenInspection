import React from "react";
import { Icon } from "./Icon";

export interface PaginationProps {
  page:             number;
  pageSize:         number;
  total:            number;
  totalPages:       number;
  onPageChange:     (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

const DEFAULT_PAGE_SIZE_OPTIONS = [12, 25, 50, 100];

function getPageItems(current: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  // 1 2 … current-1 current current+1 … totalPages-1 totalPages
  const items: Array<number | "ellipsis"> = [];
  const seen = new Set<number>();
  const push = (n: number) => {
    if (n >= 1 && n <= totalPages && !seen.has(n)) {
      seen.add(n);
      items.push(n);
    }
  };
  // Build raw ordered list with possible duplicates / out-of-range; we'll insert ellipses by gap
  const raw: number[] = [];
  const addRaw = (n: number) => {
    if (n >= 1 && n <= totalPages) raw.push(n);
  };
  addRaw(1);
  addRaw(2);
  addRaw(current - 1);
  addRaw(current);
  addRaw(current + 1);
  addRaw(totalPages - 1);
  addRaw(totalPages);

  // Deduplicate while preserving order
  const ordered: number[] = [];
  const orderedSet = new Set<number>();
  for (const n of raw) {
    if (!orderedSet.has(n)) {
      orderedSet.add(n);
      ordered.push(n);
    }
  }
  ordered.sort((a, b) => a - b);

  // Now walk ordered and insert ellipsis between non-consecutive
  for (let i = 0; i < ordered.length; i++) {
    if (i > 0 && ordered[i] - ordered[i - 1] > 1) {
      items.push("ellipsis");
    }
    push(ordered[i]);
  }
  return items;
}

const baseBtnClass =
  "inline-flex items-center justify-center min-w-9 h-9 px-2 text-[13px] font-bold rounded-md transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed";

const inactiveBtnClass =
  "border border-ih-border bg-ih-bg-card text-ih-fg-1 hover:bg-ih-bg-muted";

const activeBtnClass = "bg-ih-primary text-white";

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const items = getPageItems(page, totalPages);

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 py-3"
    >
      <div className="text-[13px] text-ih-fg-3">
        Showing {start}&ndash;{end} of {total}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          className={`${baseBtnClass} ${inactiveBtnClass}`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <Icon name="chevL" />
        </button>

        {items.map((item, idx) => {
          if (item === "ellipsis") {
            return (
              <span
                key={`ellipsis-${idx}`}
                aria-hidden="true"
                className="inline-flex items-center justify-center min-w-9 h-9 px-2 text-[13px] text-ih-fg-3"
              >
                &hellip;
              </span>
            );
          }
          const isCurrent = item === page;
          return (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={isCurrent ? "page" : undefined}
              className={`${baseBtnClass} ${isCurrent ? activeBtnClass : inactiveBtnClass}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          );
        })}

        <button
          type="button"
          aria-label="Next page"
          className={`${baseBtnClass} ${inactiveBtnClass}`}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <Icon name="chevR" />
        </button>
      </div>

      <div className="flex items-center">
        <label className="sr-only" htmlFor="ih-pagination-page-size">
          Items per page
        </label>
        <select
          id="ih-pagination-page-size"
          aria-label="Items per page"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-9 px-2 text-[13px] rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 hover:bg-ih-bg-muted focus:outline-none focus:shadow-ih-focus"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
