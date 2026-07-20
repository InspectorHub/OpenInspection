import React from "react";
import { cn } from "./cn";

export interface RadioCardOption {
  value: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface RadioCardGroupProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioCardOption[];
  legend?: React.ReactNode;
  error?: string;
  hint?: string;
  className?: string;
}

/**
 * Design System card-style single-select. A vertical stack of bordered cards,
 * each a native <label>/<input type="radio"> for form association + a11y, with
 * a title, optional description, and optional badge. The selected card lifts to
 * `border-ih-primary bg-ih-primary/5`. Use when each option needs a description
 * or badge; for short bare labels use SegmentedControl or RadioGroup.
 *
 * Keyboard: Arrow/Home/End move selection (WAI-ARIA radiogroup), skipping
 * disabled options.
 */
export function RadioCardGroup({
  name,
  value,
  onChange,
  options,
  legend,
  error,
  hint,
  className = "",
}: RadioCardGroupProps) {
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  function selectFrom(index: number, dir: 1 | -1) {
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const i = (((index + dir * step) % n) + n) % n;
      if (!options[i].disabled) {
        onChange(options[i].value);
        inputRefs.current[i]?.focus();
        return;
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        selectFrom(index, 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        selectFrom(index, -1);
        break;
    }
  }

  return (
    <fieldset role="radiogroup" className={cn("flex flex-col gap-2", className)}>
      {legend && (
        <legend className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">
          {legend}
        </legend>
      )}
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors",
              active
                ? "border-ih-primary bg-ih-primary/5"
                : "border-ih-border bg-ih-bg-card hover:border-ih-primary/40",
              o.disabled && "opacity-60 cursor-not-allowed",
            )}
          >
            <input
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="mt-0.5 h-4 w-4 accent-ih-primary shrink-0 focus:outline-none focus:shadow-ih-focus"
            />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-bold text-ih-fg-1">
                {o.title}
                {o.badge != null && (
                  <span className="font-normal text-ih-ok-fg"> {o.badge}</span>
                )}
              </span>
              {o.description != null && (
                <span className="block text-[11px] text-ih-fg-3 mt-0.5">{o.description}</span>
              )}
            </span>
          </label>
        );
      })}
      {error && <p className="text-[11px] text-ih-bad-fg mt-1">{error}</p>}
      {!error && hint && <p className="text-[11px] text-ih-fg-4 mt-1">{hint}</p>}
    </fieldset>
  );
}
