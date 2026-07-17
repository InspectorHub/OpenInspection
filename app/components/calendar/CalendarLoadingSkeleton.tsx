import { m } from "~/paraglide/messages";

const WEEKDAY_HEADERS: Array<{ key: string; label: () => string }> = [
  { key: "sun", label: () => m.calendar_weekday_sun() },
  { key: "mon", label: () => m.calendar_weekday_mon() },
  { key: "tue", label: () => m.calendar_weekday_tue() },
  { key: "wed", label: () => m.calendar_weekday_wed() },
  { key: "thu", label: () => m.calendar_weekday_thu() },
  { key: "fri", label: () => m.calendar_weekday_fri() },
  { key: "sat", label: () => m.calendar_weekday_sat() },
];

/** Month-grid placeholder shown while the calendar loader revalidates. */
export function CalendarLoadingSkeleton() {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7">
        {WEEKDAY_HEADERS.map(({ key, label }) => (
          <div
            key={key}
            className="py-2 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-ih-fg-4 border-b border-ih-border"
          >
            {label()}
          </div>
        ))}
        {Array.from({ length: 35 }).map((_, index) => (
          <div key={index} className="min-h-[90px] p-1.5 border-b border-r border-ih-border">
            <div className="w-6 h-6 rounded-full bg-ih-bg-muted animate-pulse" />
            <div className="mt-2 space-y-1">
              {index % 3 === 0 && <div className="h-4 w-full rounded bg-ih-bg-muted animate-pulse" />}
              {index % 5 === 0 && <div className="h-4 w-3/4 rounded bg-ih-bg-muted animate-pulse" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
