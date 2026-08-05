import { Link } from "react-router";
import { m } from "~/paraglide/messages";
import { isDraggableItem, minutesOfDay, type DispatchItem } from "./dispatch-helpers";

/**
 * The left rail: inspections on this day that nobody owns.
 *
 * It is a LANE, not a column — the cards carry no axis position because an
 * unassigned job's time is exactly the thing still being decided. Sorting is
 * by requested time when one exists so the rail reads like a queue, with
 * timeless jobs last rather than first (a job with no time is the least urgent
 * thing to place, not the most).
 *
 * It is also a drop target in both directions: dragging a card OUT places it on
 * someone's day, dragging one IN takes the person off and leaves the time
 * alone. Unassigning by dropping is the gesture a dispatcher already has for
 * "I need to find someone else for this".
 */
export function UnassignedLane({
  items,
  draggingId,
  onDragStartItem,
  onDragEndItem,
  onDropItem,
}: {
  items: DispatchItem[];
  draggingId: string | null;
  onDragStartItem: (id: string) => void;
  onDragEndItem: () => void;
  onDropItem: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const sorted = [...items].sort((a, b) => {
    const am = minutesOfDay(a.startTime);
    const bm = minutesOfDay(b.startTime);
    if (am == null && bm == null) return a.title.localeCompare(b.title);
    if (am == null) return 1;
    if (bm == null) return -1;
    return am - bm;
  });

  return (
    <aside
      className="w-56 shrink-0 border-r border-ih-border bg-ih-bg-muted"
      data-testid="dispatch-unassigned-lane"
      aria-label={m.dispatch_unassigned_heading()}
      onDragOver={(event) => { if (draggingId) event.preventDefault(); }}
      onDrop={onDropItem}
    >
      <div className="border-b border-ih-border px-3 py-2">
        {/* fg-2: fg-3 measured 4.34:1 on the muted rail surface in light mode. */}
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-2">
          {m.dispatch_unassigned_heading()}
          <span className="ml-2 text-ih-fg-4">{sorted.length}</span>
        </h2>
      </div>
      <div className="space-y-2 p-2" data-dispatch-dropzone="unassigned">
        {sorted.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] text-ih-fg-4">
            {m.dispatch_unassigned_empty()}
          </p>
        ) : (
          sorted.map((item) => (
            <div
              key={item.id}
              data-item-id={item.id}
              data-inspection-id={item.inspectionId ?? item.id}
              draggable={isDraggableItem(item)}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", item.id);
                event.dataTransfer.effectAllowed = "move";
                onDragStartItem(item.id);
              }}
              onDragEnd={onDragEndItem}
              className={`rounded-lg border border-ih-border bg-ih-bg-card p-2 shadow-ih-card${draggingId === item.id ? " opacity-40" : ""}`}
            >
              <div className="flex items-start gap-2">
                <span
                  data-drag-handle
                  aria-label={m.dispatch_card_grip()}
                  title={m.dispatch_card_grip()}
                  className="mt-0.5 cursor-grab select-none text-[12px] leading-none text-ih-fg-4"
                >
                  ⠿
                </span>
                <div className="min-w-0 flex-1">
                  {item.inspectionId ? (
                    <Link
                      to={`/inspections/${item.inspectionId}`}
                      className="block truncate text-[12px] font-bold text-ih-fg-1 hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <p className="truncate text-[12px] font-bold text-ih-fg-1">{item.title}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-ih-fg-3">
                    {item.startTime ?? m.dispatch_column_untimed()}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
