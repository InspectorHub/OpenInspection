/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  /** Civil day (YYYY-MM-DD) in the viewer effective tz — the ONLY key views may
   *  bucket by. Never re-derive the day from `start` via `toISOString()`. */
  civilDate: string;
  /** Wall-clock start (HH:MM) in the effective tz; omitted for all-day. */
  startTime?: string;
  /** Wall-clock end (HH:MM) in the effective tz; omitted for all-day. */
  endTime?: string;
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
  civilDate: string;
  startTime?: string;
  endTime?: string;
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
    civilDate: item.civilDate,
    ...(item.startTime ? { startTime: item.startTime } : {}),
    ...(item.endTime ? { endTime: item.endTime } : {}),
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

/** Civil date string (YYYY-MM-DD) from calendar parts. `month` is 0-based (JS
 *  Date convention). Built by string assembly, never through `toISOString()`,
 *  so it carries no UTC drift — a grid cell's key always equals its label. */
export function civilDateOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface BlockFormSeed {
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
}

/** Seed values for the Block Time create/edit form. Reads the block's
 *  effective-tz civil fields (civilDate/startTime/endTime) — NEVER slices the
 *  UTC `start` instant, which would show a tz-shifted time (e.g. 01:00 for a
 *  09:00 block viewed at UTC+8). A new block parses the day-click seed string
 *  (`YYYY-MM-DDTHH:MM`). */
export function blockFormSeed(block: CalendarEvent | null, dateSeed: string | null): BlockFormSeed {
  const allDay = block?.extendedProps?.allDay === true;
  return {
    date: block?.civilDate ?? dateSeed?.slice(0, 10) ?? "",
    startTime: allDay ? "09:00" : block?.startTime ?? dateSeed?.slice(11, 16) ?? "09:00",
    endTime: allDay ? "10:00" : block?.endTime ?? "10:00",
    allDay,
  };
}

/** Groups events by their server-provided `civilDate`. Views look cells up by
 *  the same civil string (see `civilDateOf`) — no Date/UTC math on either side. */
export function bucketEventsByCivilDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    if (!ev.civilDate) continue;
    const list = map.get(ev.civilDate);
    if (list) list.push(ev);
    else map.set(ev.civilDate, [ev]);
  }
  return map;
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
