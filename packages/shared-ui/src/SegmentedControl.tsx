import React from "react";

export interface SegmentedControlOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Native tooltip (`title` attribute) for the segment. */
  title?: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  /** `sm` (default, compact 11px) or `md` (12px). */
  size?: "sm" | "md";
  /** Accessible name for the radiogroup track. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Generic single-select segmented control. A rounded track (`bg-ih-bg-muted`)
 * holding segment buttons; the selected segment lifts onto a card surface
 * (`bg-ih-bg-card text-ih-primary shadow-ih-card`). Not theme-coupled — works
 * for any option set (view mode, filters, theme, …).
 *
 * Accessibility follows the WAI-ARIA radiogroup pattern: `role="radiogroup"`
 * on the track, `role="radio"` + `aria-checked` on each segment, a roving
 * tabindex (only the selected segment is tab-focusable), and Arrow/Home/End
 * keys that move the selection (and focus) between segments.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  size = "sm",
  ariaLabel,
  className = "",
}: SegmentedControlProps) {
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = options.findIndex((o) => o.value === value);
  // If value matches nothing, keep the first segment tab-focusable so the
  // control is always reachable by keyboard.
  const focusIndex = activeIndex < 0 ? 0 : activeIndex;

  function select(index: number) {
    const n = options.length;
    if (n === 0) return;
    const clamped = ((index % n) + n) % n;
    onChange(options[clamped].value);
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
        select(options.length - 1);
        break;
    }
  }

  const sizeClass = size === "md" ? "py-1.5 text-[12px]" : "py-1 text-[11px]";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex gap-1 p-1 bg-ih-bg-muted rounded-ih-button ${className}`}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === focusIndex ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-ih-pill font-bold transition-colors focus:outline-none focus:shadow-ih-focus ${sizeClass} ${
              active
                ? "bg-ih-bg-card text-ih-primary shadow-ih-card"
                : "bg-transparent text-ih-fg-3 hover:text-ih-fg-1"
            }`}
          >
            {o.icon != null && (
              <span className="shrink-0" aria-hidden="true">
                {o.icon}
              </span>
            )}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
