import { eventColor, formatTime, isEventDraggable, type CalendarEvent } from "~/components/calendar/calendar-helpers";

export function DayView({
  hours,
  currentDate,
  getEventsForDate,
  handleDayClick,
  handleDrop,
  handleEventClick,
}: {
  hours: number[];
  currentDate: Date;
  getEventsForDate: (d: Date) => CalendarEvent[];
  handleDayClick: (dateStr: string) => void;
  handleDrop: (eventId: string, newDate: string) => void;
  handleEventClick: (ev: CalendarEvent) => void;
}) {
  const dateStr = currentDate.toISOString().slice(0, 10);
  const allDayEvents = getEventsForDate(currentDate).filter((ev) => ev.extendedProps?.allDay === true);
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          <div className="flex min-h-[48px] border-b border-ih-border">
            <div className="w-16 shrink-0 pr-3 pt-2 text-right text-[10px] font-bold text-ih-fg-4">All day</div>
            <div
              className="flex-1 cursor-pointer border-l border-ih-border p-1 hover:bg-ih-primary-tint"
              onClick={() => handleDayClick(`${dateStr}T09:00`)}
            >
              {allDayEvents.map((ev) => (
                <button
                  key={ev.id}
                  onClick={(e) => { e.stopPropagation(); handleEventClick(ev); }}
                  draggable={isEventDraggable(ev)}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", ev.id)}
                  className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-[12px] font-bold text-white ${eventColor(ev)}`}
                >
                  {ev.title}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {hours.map((h) => {
              const dayEvents = getEventsForDate(currentDate).filter((ev) => {
                if (ev.extendedProps?.allDay === true) return false;
                const evDate = new Date(ev.start);
                return evDate.getHours() === h;
              });
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
                        draggable={isEventDraggable(ev)}
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
  );
}
