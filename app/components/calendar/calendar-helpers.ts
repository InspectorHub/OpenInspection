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

type CalendarItemKind =
  | "inspection"
  | "inspection_event"
  | "calendar_block"
  | "external_busy"
  | "company_holiday";

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color?: string;
  inspectionId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

export type CalendarScope = "my" | "team";
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

export function defaultCalendarScope(role: string | null | undefined): CalendarScope {
  // Keep in sync with isAdminRole — owners/managers open Team; inspectors open My.
  return role === "owner" || role === "manager" ? "team" : "my";
}

export function calendarItemToEvent(item: CalendarItem): CalendarEvent {
  const status = typeof item.meta?.status === "string" ? item.meta.status : undefined;
  return {
    id: item.id,
    title: item.title,
    start: item.start,
    end: item.end,
    ...(item.color ? { color: item.color } : {}),
    ...(status ? { status } : {}),
    source: item.kind,
    extendedProps: {
      kind: item.kind,
      allDay: item.allDay,
      ...(item.inspectionId ? { inspectionId: item.inspectionId } : {}),
      ...(item.userId ? { userId: item.userId } : {}),
      ...(typeof item.meta?.notes === "string" ? { notes: item.meta.notes } : {}),
    },
  };
}

export function isEventDraggable(event: CalendarEvent): boolean {
  const kind = event.extendedProps?.kind;
  if (kind) return kind === "inspection";
  return event.source !== "google" && event.extendedProps?.source !== "google";
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
  if (ev.extendedProps?.kind === "calendar_block") return "bg-ih-fg-3";
  if (ev.extendedProps?.kind === "external_busy") return "bg-ih-fg-4";
  if (ev.extendedProps?.kind === "company_holiday") return "bg-ih-watch";
  return STATUS_COLORS[ev.status || ""] || ev.backgroundColor || "bg-ih-primary";
}
