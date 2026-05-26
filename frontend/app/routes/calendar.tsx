import { useState, useMemo, useCallback } from "react";
import { useLoaderData, useFetcher, useNavigate, useNavigation } from "react-router";
import type { Route } from "./+types/calendar";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Calendar - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CalendarEvent {
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

type ViewMode = "month" | "week" | "day";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-ih-bg-muted",
  scheduled: "bg-ih-primary-600",
  confirmed: "bg-ih-primary",
  in_progress: "bg-amber-500",
  delivered: "bg-emerald-500",
  published: "bg-emerald-600",
  cancelled: "bg-red-400",
  google: "bg-violet-400",
};

function eventColor(ev: CalendarEvent): string {
  if (ev.source === "google" || ev.extendedProps?.source === "google") return STATUS_COLORS.google;
  return STATUS_COLORS[ev.status || ""] || ev.backgroundColor || "bg-ih-primary";
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
  try {
    const res = await apiFetch(`/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    const events = (body.data ?? []) as CalendarEvent[];
    return { events };
  } catch {
    return { events: [] as CalendarEvent[] };
  }
}

/* ------------------------------------------------------------------ */
/*  Action (reschedule)                                                */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "reschedule") {
    const id = formData.get("id") as string;
    const date = formData.get("date") as string;
    const res = await apiFetch(`/api/inspections/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ date }),
    });
    return { ok: res.ok };
  }
  return { ok: false };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const { events } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  /* ---- Navigation ---- */
  const prev = () => {
    if (viewMode === "month") setCurrentDate(new Date(year, month - 1, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, -7));
    else setCurrentDate(addDays(currentDate, -1));
  };
  const next = () => {
    if (viewMode === "month") setCurrentDate(new Date(year, month + 1, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };
  const goToday = () => setCurrentDate(new Date());

  const headerTitle = useMemo(() => {
    if (viewMode === "month") return currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (viewMode === "week") {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      return `${ws.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${we.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [currentDate, viewMode]);

  /* ---- Events lookup ---- */
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = ev.start ? new Date(ev.start) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  function getEventsForDate(d: Date) {
    return eventsByDate.get(d.toISOString().slice(0, 10)) || [];
  }

  /* ---- Meta ---- */
  const now = new Date();
  const weekEnd = addDays(now, 7);
  const thisWeekEvents = events.filter((e) => {
    const d = new Date(e.start);
    return d >= now && d < weekEnd;
  });
  const drafts = thisWeekEvents.filter((e) => e.status === "draft" || e.isDraft);
  const confirmed = thisWeekEvents.length - drafts.length;

  /* ---- Month grid ---- */
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  /* ---- Week view ---- */
  const weekStart = startOfWeek(viewMode === "week" ? currentDate : today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7 AM to 8 PM

  /* ---- Event click ---- */
  const handleEventClick = (ev: CalendarEvent) => {
    if (ev.source === "google" || ev.extendedProps?.source === "google") return;
    setSelectedEvent(ev);
    setEventModalOpen(true);
  };

  /* ---- Day click (create) ---- */
  const handleDayClick = (dateStr: string) => {
    navigate(`/dashboard?newInspection=1&date=${encodeURIComponent(dateStr)}`);
  };

  /* ---- Drag reschedule ---- */
  const handleDrop = (eventId: string, newDate: string) => {
    fetcher.submit({ intent: "reschedule", id: eventId, date: newDate }, { method: "post" });
  };

  return (
    <div className="space-y-[18px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-ih-primary-tint text-ih-primary">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Calendar
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Calendar</h1>
          <p className="text-[13px] text-ih-fg-3 mt-1">
            {thisWeekEvents.length === 0
              ? "No inspections scheduled this week"
              : drafts.length > 0
                ? `${confirmed} confirmed · ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`
                : `${thisWeekEvents.length} this week`}
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="h-9 w-9 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted text-lg">
            &lsaquo;
          </button>
          <button onClick={next} className="h-9 w-9 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted text-lg">
            &rsaquo;
          </button>
          <button onClick={goToday} className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted">
            Today
          </button>
        </div>
        <h2 className="text-xl font-bold text-ih-fg-1">{headerTitle}</h2>
        <div className="flex items-center gap-1">
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`h-9 px-3 rounded-md text-[13px] font-bold capitalize border transition-colors ${viewMode === v ? "border-ih-primary text-ih-primary bg-ih-primary-tint" : "border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-7">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-ih-fg-4 border-b border-ih-border">
                {d}
              </div>
            ))}
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="min-h-[90px] p-1.5 border-b border-r border-ih-border">
                <div className="w-6 h-6 rounded-full bg-ih-bg-muted animate-pulse" />
                <div className="mt-2 space-y-1">
                  {i % 3 === 0 && <div className="h-4 w-full rounded bg-ih-bg-muted animate-pulse" />}
                  {i % 5 === 0 && <div className="h-4 w-3/4 rounded bg-ih-bg-muted animate-pulse" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Month grid */}
      {!isLoading && viewMode === "month" && (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-7">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-ih-fg-4 border-b border-ih-border">
                {d}
              </div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[90px] border-b border-r border-ih-border bg-ih-bg-muted" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateObj = new Date(year, month, day);
              const dateStr = dateObj.toISOString().slice(0, 10);
              const dayEvents = getEventsForDate(dateObj);
              return (
                <div
                  key={day}
                  className={`min-h-[90px] p-1.5 border-b border-r border-ih-border cursor-pointer hover:bg-ih-primary-tint transition-colors ${isToday(day) ? "bg-ih-primary-tint" : ""}`}
                  onClick={() => handleDayClick(`${dateStr}T09:00`)}
                  onDragOver={(e) => { e.preventDefault(); setDragTarget(dateStr); }}
                  onDragLeave={() => setDragTarget(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const evId = e.dataTransfer.getData("text/plain");
                    if (evId) handleDrop(evId, `${dateStr}T09:00:00.000Z`);
                    setDragTarget(null);
                  }}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-medium ${isToday(day) ? "bg-ih-primary text-white" : "text-ih-fg-2"}`}>
                    {day}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                        draggable={ev.source !== "google" && ev.extendedProps?.source !== "google"}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", ev.id)}
                        className={`w-full text-left px-1 py-0.5 rounded text-[10px] font-medium text-white truncate ${eventColor(ev)} ${ev.isDraft ? "border border-dashed border-white/40 opacity-80" : ""}`}
                      >
                        {ev.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-ih-fg-4 font-bold">+{dayEvents.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week view */}
      {!isLoading && viewMode === "week" && (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border">
            <div className="py-2 px-1" />
            {weekDays.map((d) => (
              <div key={d.toISOString()} className={`py-2 px-2 text-center border-l border-ih-border ${isSameDay(d, today) ? "bg-ih-primary-tint" : ""}`}>
                <span className="text-[10px] font-bold uppercase text-ih-fg-4 block">
                  {d.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span className={`text-[14px] font-bold ${isSameDay(d, today) ? "text-ih-primary" : "text-ih-fg-2"}`}>
                  {d.getDate()}
                </span>
              </div>
            ))}
          </div>
          {/* Time slots */}
          <div className="max-h-[500px] overflow-y-auto">
            {hours.map((h) => (
              <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border min-h-[48px]">
                <div className="text-[10px] font-bold text-ih-fg-4 text-right pr-2 pt-1">
                  {h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}
                </div>
                {weekDays.map((d) => {
                  const dayEvents = getEventsForDate(d).filter((ev) => {
                    const evDate = new Date(ev.start);
                    return evDate.getHours() === h;
                  });
                  const dateStr = d.toISOString().slice(0, 10);
                  return (
                    <div
                      key={d.toISOString() + h}
                      className="border-l border-ih-border p-0.5 cursor-pointer hover:bg-ih-primary-tint"
                      onClick={() => handleDayClick(`${dateStr}T${String(h).padStart(2, "0")}:00`)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const evId = e.dataTransfer.getData("text/plain");
                        if (evId) handleDrop(evId, `${dateStr}T${String(h).padStart(2, "0")}:00:00.000Z`);
                      }}
                    >
                      {dayEvents.map((ev) => (
                        <button
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", ev.id)}
                          className={`w-full text-left px-1 py-0.5 rounded text-[10px] font-medium text-white truncate mb-0.5 ${eventColor(ev)}`}
                        >
                          {ev.title}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Day view */}
      {!isLoading && viewMode === "day" && (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          <div className="max-h-[600px] overflow-y-auto">
            {hours.map((h) => {
              const dayEvents = getEventsForDate(currentDate).filter((ev) => {
                const evDate = new Date(ev.start);
                return evDate.getHours() === h;
              });
              const dateStr = currentDate.toISOString().slice(0, 10);
              return (
                <div key={h} className="flex border-b border-ih-border min-h-[56px]">
                  <div className="w-16 text-[11px] font-bold text-ih-fg-4 text-right pr-3 pt-2 shrink-0">
                    {h > 12 ? h - 12 : h}:00 {h >= 12 ? "PM" : "AM"}
                  </div>
                  <div
                    className="flex-1 p-1 cursor-pointer hover:bg-ih-primary-tint border-l border-ih-border"
                    onClick={() => handleDayClick(`${dateStr}T${String(h).padStart(2, "0")}:00`)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const evId = e.dataTransfer.getData("text/plain");
                      if (evId) handleDrop(evId, `${dateStr}T${String(h).padStart(2, "0")}:00:00.000Z`);
                    }}
                  >
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", ev.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-bold text-white mb-1 ${eventColor(ev)}`}
                      >
                        {ev.title}
                        {ev.start && <span className="ml-2 opacity-80 text-[10px]">{formatTime(new Date(ev.start))}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event detail modal */}
      {eventModalOpen && selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEventModalOpen(false)}>
          <div className="w-full max-w-sm bg-ih-bg-card rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[16px] font-bold text-ih-fg-1">{selectedEvent.title}</h2>
              <button onClick={() => setEventModalOpen(false)} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg">&times;</button>
            </div>
            <div className="space-y-2 text-[13px] text-ih-fg-3">
              <p>
                <span className="font-bold text-ih-fg-3 text-[11px] uppercase">Date:</span>{" "}
                {selectedEvent.start ? new Date(selectedEvent.start).toLocaleString() : "N/A"}
              </p>
              {selectedEvent.status && (
                <p>
                  <span className="font-bold text-ih-fg-3 text-[11px] uppercase">Status:</span>{" "}
                  {selectedEvent.status.replace(/_/g, " ")}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEventModalOpen(false)} className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3">
                Close
              </button>
              {selectedEvent.url && (
                <button
                  onClick={() => { navigate(selectedEvent.url || `/inspections/${selectedEvent.id}/edit`); setEventModalOpen(false); }}
                  className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600"
                >
                  Open Inspection
                </button>
              )}
              {!selectedEvent.url && (
                <button
                  onClick={() => { navigate(`/inspections/${selectedEvent.id}/edit`); setEventModalOpen(false); }}
                  className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600"
                >
                  Open Inspection
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
