import { Link } from "react-router";

export interface TimeOffBlock {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
}

function formatBlockWindow(block: TimeOffBlock): string {
  if (block.allDay || (!block.startTime && !block.endTime)) return "All day";
  if (block.startTime && block.endTime) return `${block.startTime}–${block.endTime}`;
  return block.startTime ?? block.endTime ?? "All day";
}

export function TimeOffListPanel({
  blocks,
}: {
  blocks: TimeOffBlock[];
}) {
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Time off</h3>
      <p className="text-[12px] text-ih-fg-3">
        Personal time off lives on the calendar. Add or edit blocks there — this list is a quick
        view of what you already scheduled.
      </p>

      {blocks.length > 0 ? (
        <div className="space-y-2">
          {blocks.map((block) => (
            <div
              key={block.id}
              className="flex items-center justify-between gap-3 bg-ih-bg-muted rounded-md px-3 py-2 border border-ih-border"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-ih-fg-1 truncate">{block.title}</p>
                <p className="text-[12px] text-ih-fg-3">
                  {block.date} · {formatBlockWindow(block)}
                </p>
              </div>
              <Link
                to="/calendar"
                className="text-[12px] text-ih-primary font-bold hover:underline shrink-0"
              >
                Open calendar
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2" data-testid="time-off-empty">
          <p className="text-[12px] text-ih-fg-4 italic">No time off scheduled.</p>
          <Link
            to="/calendar"
            className="inline-flex h-8 px-3 items-center rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors"
          >
            Block time on calendar
          </Link>
        </div>
      )}
    </section>
  );
}
