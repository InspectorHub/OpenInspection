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
    <div className="flex items-center justify-between">
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
      <div className="relative">
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
      <div className="flex items-center gap-1">
        {(["month", "week", "day"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            className={`h-9 px-3 rounded-md text-[13px] font-bold capitalize border transition-colors ${
              viewMode === mode
                ? "border-ih-primary text-ih-primary bg-ih-primary-tint"
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
