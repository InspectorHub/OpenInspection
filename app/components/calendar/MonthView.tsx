import { eventColor, type CalendarEvent } from "~/components/calendar/calendar-helpers";

export function MonthView({
  firstDay,
  daysInMonth,
  year,
  month,
  getEventsForDate,
  isToday,
  handleDayClick,
  setDragTarget,
  handleDrop,
  handleEventClick,
}: {
  firstDay: number;
  daysInMonth: number;
  year: number;
  month: number;
  getEventsForDate: (d: Date) => CalendarEvent[];
  isToday: (day: number) => boolean;
  handleDayClick: (dateStr: string) => void;
  setDragTarget: (target: string | null) => void;
  handleDrop: (eventId: string, newDate: string) => void;
  handleEventClick: (ev: CalendarEvent) => void;
}) {
  return (
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
  );
}
