import React from "react";
import { cn } from "../../../packages/shared-ui/src/cn";

export type RatingTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface RatingOption {
  value: string;
  label: string;
  tone: RatingTone;
  /** Short form for compact layouts (e.g. an abbreviation, or a bare index
   *  for BatchActionBar's numbered tiles). Falls back to `label` when
   *  omitted — used at `size="sm"`. */
  shortLabel?: string;
  /** Small hint rendered under the label (e.g. a keyboard-shortcut digit,
   *  mirroring RatingButtonRow's/SpeedMode's `idx + 1` hint). Also appended
   *  to the tile's `title` tooltip. */
  hint?: string;
  /** Dynamic, data-driven color override (e.g. a tenant-configured hex from
   *  the rating system). Wins over the tone token classes when present —
   *  mirrors BatchActionBar's existing `getRatingColor` inline-style
   *  pattern. Applies regardless of selection state: data-driven callers
   *  (batch mode) render every tile permanently in its assigned color, not
   *  just the currently-selected one. */
  color?: string;
}

export interface RatingSegmentProps {
  ratings: RatingOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  /** `sm` (compact/icon tiles) · `md` (default row, RatingButtonRow-like) ·
   *  `lg` (large touch tiles, SpeedMode-like). Default `md`. */
  size?: "sm" | "md" | "lg";
  /** Accessible name for the radiogroup. */
  ariaLabel?: string;
  className?: string;
}

/* Single source of truth for severity-tone -> token mapping. `warn` uses the
 * `ih-watch` token family — there is no `ih-warn` token in tailwind.css (the
 * design system's "watch" naming predates this component); this is the
 * closest real token and matches RatingButtonRow's existing `marginal`
 * tier. */
const TONE_FILLED: Record<RatingTone, string> = {
  ok: "bg-ih-ok text-ih-fg-inverse",
  warn: "bg-ih-watch text-ih-fg-inverse",
  bad: "bg-ih-bad text-ih-fg-inverse",
  info: "bg-ih-info text-ih-fg-inverse",
  // Solid inverse chip (not `bg-ih-bg-muted`) — muted-bg + inverse-fg pairs
  // to ~1:1 contrast in both themes. This mirrors the pre-migration
  // RatingButtonRow `minor` tier's `bg-ih-bg-inverse`, which flips with
  // theme and correctly pairs with `ih-fg-inverse`.
  neutral: "bg-ih-bg-inverse text-ih-fg-inverse",
};

const TONE_IDLE: Record<RatingTone, string> = {
  ok: "bg-ih-ok-bg text-ih-ok-fg border border-ih-ok/30 hover:bg-ih-ok/20",
  warn: "bg-ih-watch-bg text-ih-watch-fg border border-ih-watch/30 hover:bg-ih-watch/20",
  bad: "bg-ih-bad-bg text-ih-bad-fg border border-ih-bad/30 hover:bg-ih-bad/20",
  info: "bg-ih-info-bg text-ih-info-fg border border-ih-info/30 hover:bg-ih-info/20",
  neutral: "bg-transparent text-ih-fg-3 border border-ih-border hover:bg-ih-bg-muted",
};

const SIZE_CLASSES: Record<NonNullable<RatingSegmentProps["size"]>, string> = {
  sm: "h-8 min-w-8 px-2 rounded text-[11px] font-bold",
  md: "h-11 min-w-0 flex-1 px-3 rounded-lg text-[13px] font-bold",
  lg: "h-20 w-20 rounded-xl text-sm font-bold",
};

/**
 * Domain rating-tile row. Consolidates the three hand-rolled rating-tile
 * copies (RatingButtonRow, BatchActionBar, SpeedMode) into one component;
 * lives in the app (not shared-ui) because the severity tone map is
 * domain-coupled (inspection rating severities), not a generic UI concern.
 *
 * Accessibility follows the same WAI-ARIA radiogroup pattern as
 * `SegmentedControl`: `role="radiogroup"` on the container, `role="radio"` +
 * `aria-checked` on each tile, a roving tabindex (only the selected tile is
 * tab-focusable), and Arrow/Home/End keys that move selection + focus.
 */
export function RatingSegment({
  ratings,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className = "",
}: RatingSegmentProps) {
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = ratings.findIndex((r) => r.value === value);
  // If value matches nothing, keep the first tile tab-focusable so the
  // group is always reachable by keyboard.
  const focusIndex = selectedIndex < 0 ? 0 : selectedIndex;

  function select(index: number) {
    const n = ratings.length;
    if (n === 0) return;
    const clamped = ((index % n) + n) % n;
    onChange(ratings[clamped].value);
    btnRefs.current[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(index - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(ratings.length - 1);
        break;
    }
  }

  const sizeClass = SIZE_CLASSES[size];

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex gap-2 flex-wrap", className)}
    >
      {ratings.map((r, i) => {
        const selected = r.value === value;
        const toneClass = selected ? TONE_FILLED[r.tone] : TONE_IDLE[r.tone];
        // A per-option `color` override wins over the tone token classes
        // (data-driven, like BatchActionBar's existing pattern) and applies
        // regardless of selection — see the RatingOption.color doc above.
        const style = r.color ? { background: r.color, color: "#fff" } : undefined;
        // At `size="sm"` (compact tiles, e.g. BatchActionBar) always show the
        // short form. At md/lg, responsively swap: shortLabel below the `sm`
        // breakpoint, full label at `sm` and up — mirrors the pre-migration
        // RatingButtonRow behavior of abbreviating on narrow screens. When no
        // `shortLabel` is provided, just render the full label everywhere.
        const text =
          size === "sm" ? (
            (r.shortLabel ?? r.label)
          ) : r.shortLabel ? (
            <>
              <span className="sm:hidden">{r.shortLabel}</span>
              <span className="hidden sm:inline">{r.label}</span>
            </>
          ) : (
            r.label
          );
        const title = r.hint ? `${r.label} (${r.hint})` : r.label;
        return (
          <button
            key={r.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={r.label}
            title={title}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(r.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`transition-colors focus:outline-none focus:shadow-ih-focus ${sizeClass} ${
              r.color ? "" : toneClass
            }`}
            style={style}
          >
            <span className="truncate px-0.5">{text}</span>
            {r.hint != null && (
              <span className="block text-[9px] font-mono opacity-60 mt-0.5">{r.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
