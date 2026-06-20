/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  url?: string;
  color?: string;
  backgroundColor?: string;
  status?: string;
  isDraft?: boolean;
  source?: string;
  extendedProps?: Record<string, unknown>;
}

export type ViewMode = "month" | "week" | "day";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */


export function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ih-bg-muted",
  scheduled: "bg-ih-primary-600",
  confirmed: "bg-ih-primary",
  in_progress: "bg-ih-watch",
  delivered: "bg-ih-ok",
  published: "bg-ih-ok",
  cancelled: "bg-ih-bad",
  // ds-allow: Google-source events keep Google Calendar's violet brand hue
  google: "bg-violet-400",
};

export function eventColor(ev: CalendarEvent): string {
  if (ev.source === "google" || ev.extendedProps?.source === "google") return STATUS_COLORS.google;
  return STATUS_COLORS[ev.status || ""] || ev.backgroundColor || "bg-ih-primary";
}
