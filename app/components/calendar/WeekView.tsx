import { civilDateOf, eventColor, isEventDraggable, isSameDay, type CalendarEvent } from "~/components/calendar/calendar-helpers";

/** Hour (0-23) a timed event starts at, from its effective-tz wall clock. */
function eventStartHour(ev: CalendarEvent): number {
  return ev.startTime ? parseInt(ev.startTime.slice(0, 2), 10) : NaN;
}

export function WeekView({
  weekDays,
  today,
  hours,
  locale,
  getEventsForDate,
  handleDayClick,
  handleDrop,
  handleEventClick,
}: {
  weekDays: Date[];
  today: Date;
  hours: number[];
  locale: string;
  getEventsForDate: (civilDate: string) => CalendarEvent[];
  handleDayClick: (dateStr: string) => void;
  handleDrop: (eventId: string, newDate: string) => void;
  handleEventClick: (ev: CalendarEvent) => void;
}) {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border">
            <div className="py-2 px-1" />
            {weekDays.map((d) => (
              <div key={civilDateOf(d.getFullYear(), d.getMonth(), d.getDate())} className={`py-2 px-2 text-center border-l border-ih-border ${isSameDay(d, today) ? "bg-ih-primary-tint" : ""}`}>
                <span className="text-[10px] font-bold uppercase text-ih-fg-4 block">
                  {d.toLocaleDateString(locale, { weekday: "short" })}
                </span>
                <span className={`text-[14px] font-bold ${isSameDay(d, today) ? "text-ih-primary" : "text-ih-fg-2"}`}>
                  {d.getDate()}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border min-h-[42px]">
            <div className="text-[10px] font-bold text-ih-fg-4 text-right pr-2 pt-2">All day</div>
            {weekDays.map((d) => {
              const dateStr = civilDateOf(d.getFullYear(), d.getMonth(), d.getDate());
              const allDayEvents = getEventsForDate(dateStr).filter((ev) => ev.extendedProps?.allDay === true);
              return (
                <div
                  key={`all-day-${civilDateOf(d.getFullYear(), d.getMonth(), d.getDate())}`}
                  className="border-l border-ih-border p-0.5 cursor-pointer hover:bg-ih-primary-tint"
                  onClick={() => handleDayClick(`${dateStr}T09:00`)}
                >
                  {allDayEvents.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                      draggable={isEventDraggable(ev)}
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
          {/* Time slots */}
          <div className="max-h-[500px] overflow-y-auto">
            {hours.map((h) => (
              <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border min-h-[48px]">
                <div className="text-[10px] font-bold text-ih-fg-4 text-right pr-2 pt-1">
                  {h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}
                </div>
                {weekDays.map((d) => {
                  const dateStr = civilDateOf(d.getFullYear(), d.getMonth(), d.getDate());
                  const dayEvents = getEventsForDate(dateStr).filter((ev) => {
                    if (ev.extendedProps?.allDay === true) return false;
                    return eventStartHour(ev) === h;
                  });
                  return (
                    <div
                      key={dateStr + h}
                      className="border-l border-ih-border p-0.5 cursor-pointer hover:bg-ih-primary-tint"
                      onClick={() => handleDayClick(`${dateStr}T${String(h).padStart(2, "0")}:00`)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const evId = e.dataTransfer.getData("text/plain");
                        if (evId) handleDrop(evId, dateStr);
                      }}
                    >
                      {dayEvents.map((ev) => (
                        <button
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                          draggable={isEventDraggable(ev)}
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
  );
}
