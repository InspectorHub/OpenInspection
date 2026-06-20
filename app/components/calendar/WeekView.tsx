import { eventColor, isSameDay, type CalendarEvent } from "~/components/calendar/calendar-helpers";

export function WeekView({
  weekDays,
  today,
  hours,
  getEventsForDate,
  handleDayClick,
  handleDrop,
  handleEventClick,
}: {
  weekDays: Date[];
  today: Date;
  hours: number[];
  getEventsForDate: (d: Date) => CalendarEvent[];
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
  );
}
