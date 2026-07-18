import { m } from "~/paraglide/messages";

export type HeatmapStatus = "open" | "full" | "closed" | "unconfigured";

export interface HeatmapDay {
  date: string;
  status: HeatmapStatus;
  /** Holiday name, supplied by the server when the day is closed. */
  label?: string;
}

const STATUS_CLASS: Record<HeatmapStatus, string> = {
  open: "bg-ih-ok text-ih-fg-inverse",
  full: "bg-ih-watch text-ih-fg-inverse",
  closed: "bg-ih-bad text-ih-fg-inverse",
  unconfigured: "bg-ih-bg-muted text-ih-fg-4",
};

function statusLabel(status: HeatmapStatus): string {
  const labels: Record<HeatmapStatus, string> = {
    open: m.schedule_heatmap_open(),
    full: m.schedule_heatmap_full(),
    closed: m.schedule_heatmap_closed(),
    unconfigured: m.schedule_heatmap_unconfigured(),
  };
  return labels[status];
}

/**
 * A civil date names a calendar day, not an instant, so it renders the same in
 * every viewer timezone. `YYYY-MM-DD` is anchored at UTC midnight, and reading
 * it back in UTC is what keeps that promise — formatting it in the viewer's
 * zone would slide the whole strip a day earlier west of Greenwich.
 */
function civilParts(date: string, locale: string): { weekday: string; day: string } {
  const anchored = new Date(`${date}T00:00:00.000Z`); // tz-lint-ok: civil date read back in UTC below
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(anchored),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(anchored),
  };
}

/**
 * Presentational week strip: one cell per day, colored by bookability. The
 * caller owns the data and the viewer locale.
 */
export function AvailabilityHeatmapWeek({
  days,
  locale,
}: {
  days: HeatmapDay[];
  locale: string;
}) {
  if (days.length === 0) return null;

  return (
    <section data-testid="availability-heatmap-week" aria-label={m.schedule_heatmap_heading()}>
      <ul className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const { weekday, day: dayNumber } = civilParts(day.date, locale);
          const status = statusLabel(day.status);
          const title = day.label ? `${status} · ${day.label}` : status;
          return (
            <li key={day.date}>
              <div
                data-testid="heatmap-cell"
                data-status={day.status}
                title={title}
                className={`rounded px-1 py-1.5 text-center ${STATUS_CLASS[day.status]}`}
              >
                <span data-testid="heatmap-weekday" className="block text-[10px] font-bold uppercase opacity-80">
                  {weekday}
                </span>
                <span data-testid="heatmap-day-number" className="block text-[13px] font-bold">
                  {dayNumber}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
