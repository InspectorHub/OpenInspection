import { useRef, useState } from "react";
import { Icon } from "@core/shared-ui";
import { CalendarDatePicker } from "~/components/calendar/CalendarDatePicker";
import type { ViewMode } from "~/components/calendar/calendar-helpers";
import { m } from "~/paraglide/messages";

const VIEW_LABELS: Record<ViewMode, () => string> = {
  month: () => m.calendar_view_month(),
  week: () => m.calendar_view_week(),
  day: () => m.calendar_view_day(),
};

interface CalendarNavBarProps {
  title: string;
  viewMode: ViewMode;
  currentDate: Date;
  locale: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onJumpToMonth: (date: Date) => void;
  onViewModeChange: (mode: ViewMode) => void;
}

export function CalendarNavBar({
  title,
  viewMode,
  currentDate,
  locale,
  onPrev,
  onNext,
  onToday,
  onJumpToMonth,
  onViewModeChange,
}: CalendarNavBarProps) {
  const titleRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    // The same three rules as `PageHeader` (packages/shared-ui/src/PageHeader.tsx),
    // applied here because these controls are NOT page-header actions: /calendar
    // passes `PageHeader` a title and meta only, and the month/week/day buttons
    // live in this row. The header fix therefore never reached this page.
    //
    // `flex-wrap` on the row: without it the row is `nowrap`, so once the three
    // groups (~110px of prev/next/today, a `text-xl` month title, three view
    // buttons) stop fitting, the view buttons have nowhere to go but off the
    // right edge — taking a horizontal scrollbar on the document with them.
    //
    // `min-w-0` on the title column: a flex item's automatic minimum size is its
    // min-content width, so a long localized month title refuses to shrink below
    // its longest word and keeps the space the view buttons needed.
    //
    // The view-mode block wraps INTERNALLY and stays shrinkable (no
    // `flex-shrink-0`), so at the narrowest widths it reflows within itself
    // rather than holding its full width against the row.
    //
    // `gap-y-2` only matters once the row wraps — it keeps the wrapped line off
    // the one above. `gap-x-3` is a MINIMUM between groups, so `justify-between`
    // still spreads them exactly as before on a wide screen.
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label={m.calendar_nav_previous()}
          className="h-9 w-9 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
        >
          <Icon name="chevL" size={18} />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label={m.common_next()}
          className="h-9 w-9 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
        >
          <Icon name="chevR" size={18} />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted"
        >
          {m.calendar_nav_today()}
        </button>
      </div>
      <div className="relative min-w-0">
        <button
          ref={titleRef}
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={m.calendar_datepicker_open()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xl font-bold text-ih-fg-1 hover:bg-ih-bg-muted transition-colors"
        >
          {title}
          <Icon name="chevD" size={16} className="text-ih-fg-3" />
        </button>
        <CalendarDatePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          anchorRef={titleRef}
          value={currentDate}
          onSelect={onJumpToMonth}
          locale={locale}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {(["month", "week", "day"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            className={`h-9 px-3 rounded-md text-[13px] font-bold capitalize border transition-colors ${
              viewMode === mode
                ? "border-ih-primary text-ih-primary-text bg-ih-primary-tint"
                : "border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted"
            }`}
          >
            {VIEW_LABELS[mode]()}
          </button>
        ))}
      </div>
    </div>
  );
}
