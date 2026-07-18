import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { Icon, Popover } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** Cells shown in the year grid — a 4×3 window (e.g. 2020 … 2031). Arrows step
 *  by exactly this window, so browsing never overlaps a year already on screen. */
const YEAR_WINDOW = 12;

type Level = "months" | "years";

function monthShortNames(locale: string): string[] {
  // Locale-derived, so no hardcoded month strings to translate. Year 2000 is an
  // arbitrary non-leap anchor; only the month field is read.
  return Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleDateString(locale, { month: "short" }),
  );
}

/** The 12-year grid opens anchored to the decade of the active year (2026 →
 *  2020…2031), then pages by the full window so browsing never repeats a year. */
function decadeStart(year: number): number {
  return Math.floor(year / 10) * 10;
}

/**
 * Drill / zoom-out date jump for the calendar header. Two levels sharing one
 * panel: a month grid whose caption steps years, and a year grid whose caption
 * steps year-windows — the pattern MUI, Ant Design and react-day-picker use.
 * Picking a month calls `onSelect` with the first of that month and closes; the
 * views re-anchor off that date. Built on the shared Popover (Esc / click-out /
 * focus handling), so it adds no scroll-lock and no new dependency.
 */
export function CalendarDatePicker({
  open,
  onClose,
  anchorRef,
  value,
  onSelect,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  value: Date;
  onSelect: (date: Date) => void;
  locale: string;
}) {
  const [level, setLevel] = useState<Level>("months");
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [winStart, setWinStart] = useState(() => decadeStart(value.getFullYear()));

  // Re-seed to the active month each time the panel opens, and always start at
  // the months level — a prior drill into years should not persist across opens.
  useEffect(() => {
    if (open) {
      setViewYear(value.getFullYear());
      setLevel("months");
    }
  }, [open, value]);

  const months = monthShortNames(locale);
  const selectedYear = value.getFullYear();
  const selectedMonth = value.getMonth();

  function pickMonth(monthIndex: number) {
    onSelect(new Date(viewYear, monthIndex, 1));
    onClose();
  }

  function pickYear(year: number) {
    setViewYear(year);
    setLevel("months");
  }

  function openYears() {
    setWinStart(decadeStart(viewYear));
    setLevel("years");
  }

  const winEnd = winStart + YEAR_WINDOW - 1;

  const arrowClass =
    "h-8 w-8 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted";

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} align="left">
      <div data-testid="calendar-date-picker" className="w-64 p-3">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            aria-label={level === "months" ? m.calendar_datepicker_prev_year() : m.calendar_datepicker_prev_years()}
            onClick={() =>
              level === "months"
                ? setViewYear((y) => y - 1)
                : setWinStart((s) => s - YEAR_WINDOW)
            }
            className={arrowClass}
          >
            <Icon name="chevL" size={16} />
          </button>
          {level === "months" ? (
            <button
              type="button"
              aria-label={m.calendar_datepicker_choose_year()}
              onClick={openYears}
              className="flex-1 h-8 rounded-md text-[13px] font-bold text-ih-fg-1 hover:bg-ih-bg-muted"
            >
              {viewYear}
            </button>
          ) : (
            <span className="flex-1 text-center text-[13px] font-bold text-ih-fg-1">
              {m.calendar_datepicker_year_range({ start: winStart, end: winEnd })}
            </span>
          )}
          <button
            type="button"
            aria-label={level === "months" ? m.calendar_datepicker_next_year() : m.calendar_datepicker_next_years()}
            onClick={() =>
              level === "months"
                ? setViewYear((y) => y + 1)
                : setWinStart((s) => s + YEAR_WINDOW)
            }
            className={arrowClass}
          >
            <Icon name="chevR" size={16} />
          </button>
        </div>

        {level === "months" ? (
          <div className="grid grid-cols-3 gap-1">
            {months.map((label, i) => {
              const active = viewYear === selectedYear && i === selectedMonth;
              return (
                <button
                  key={label}
                  type="button"
                  data-testid={`dp-month-${i}`}
                  aria-pressed={active}
                  onClick={() => pickMonth(i)}
                  className={`h-9 rounded-md text-[13px] font-medium border transition-colors ${
                    active
                      ? "border-ih-primary text-ih-primary bg-ih-primary-tint font-bold"
                      : "border-transparent text-ih-fg-2 hover:bg-ih-bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: YEAR_WINDOW }, (_, i) => winStart + i).map((yr) => {
              const active = yr === selectedYear;
              return (
                <button
                  key={yr}
                  type="button"
                  data-testid={`dp-year-${yr}`}
                  aria-pressed={active}
                  onClick={() => pickYear(yr)}
                  className={`h-9 rounded-md text-[13px] font-medium border transition-colors ${
                    active
                      ? "border-ih-primary text-ih-primary bg-ih-primary-tint font-bold"
                      : "border-transparent text-ih-fg-2 hover:bg-ih-bg-muted"
                  }`}
                >
                  {yr}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Popover>
  );
}
