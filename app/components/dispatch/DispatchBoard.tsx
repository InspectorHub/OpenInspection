import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { EmptyState } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { pushToast } from "~/hooks/useToast";
import { UnassignedLane } from "./UnassignedLane";
import { ConflictModal } from "./ConflictModal";
import { InspectorColumn, TimeGutter } from "./DispatchColumn";
import {
  axisHeightPx,
  boardHours,
  closureItems,
  currentStartMs,
  isDraggableItem,
  minuteFromOffsetY,
  minuteToEpochMs,
  type DispatchItem,
  type DispatchPayload,
  type RescheduleResult,
  type ScheduleConflict,
} from "./dispatch-helpers";

/**
 * The dispatch board: one column per schedulable person, one shared time axis,
 * and the unassigned lane pinned to the left.
 *
 * Dragging uses the platform's own HTML5 drag-and-drop, the same mechanism the
 * calendar's day/week/month views already use. The plan reached for sortablejs
 * because it is already a dependency — but sortablejs REORDERS DOM CHILDREN,
 * and every card here is absolutely positioned on a time axis. Its drop model
 * ("between these two siblings") cannot express this board's only question,
 * "which pixel did you let go at", and making it answer that means mutating the
 * DOM and then undoing the mutation so React can re-render from server state.
 * HTML5 DnD answers it directly with `clientY`, adds no dependency either, and
 * leaves React the single source of truth.
 *
 * A drop is one write: `PATCH /api/inspections/:id/schedule` through the route
 * action, carrying both the new instant and the new lead. Time and ownership
 * move together because a dispatcher's gesture moves them together — two calls
 * would leave a window where the board shows a job at a time nobody owns.
 */
export function DispatchBoard({ board }: { board: DispatchPayload }) {
  const fetcher = useFetcher<RescheduleResult>();
  const hours = boardHours();
  const closures = closureItems(board.items);
  const axisPx = axisHeightPx();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ inspectorId: string; minute: number } | null>(null);
  const [blocked, setBlocked] = useState<ScheduleConflict[] | null>(null);

  const byId = useMemo(
    () => new Map(board.items.map((item) => [item.id, item])),
    [board.items],
  );

  // Report each result once. `fetcher.data` survives across re-renders, so a
  // plain effect on it would re-toast on every unrelated state change — the
  // board has several (hover, drag id), and a warning that reappears when you
  // move the mouse reads as a second failure.
  const handled = useRef<RescheduleResult | null>(null);
  useEffect(() => {
    const data = fetcher.data;
    if (!data || fetcher.state !== "idle" || handled.current === data) return;
    handled.current = data;
    if (data.ok) {
      if (data.conflicts && data.conflicts.length > 0) {
        pushToast({ message: m.dispatch_toast_overlap(), variant: "warning", durationMs: 6000 });
      }
      return;
    }
    if (data.code === "SCHEDULE_CONFLICT") {
      setBlocked(data.conflicts ?? []);
      return;
    }
    pushToast({
      message: data.message || m.dispatch_toast_failed(),
      variant: "error",
      durationMs: 6000,
    });
  }, [fetcher.data, fetcher.state]);

  const dragged = draggingId ? byId.get(draggingId) ?? null : null;

  function move(item: DispatchItem, startMs: number, leadInspectorId: string) {
    if (!item.inspectionId) return;
    fetcher.submit(
      {
        intent: "reschedule",
        inspectionId: item.inspectionId,
        scheduledStartMs: String(startMs),
        leadInspectorId,
      },
      { method: "post" },
    );
  }

  function dropOnColumn(inspectorId: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setHover(null);
    setDraggingId(null);
    if (!dragged || !isDraggableItem(dragged)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = minuteFromOffsetY(event.clientY - rect.top, board.slotIntervalMin);
    // A drop with no usable pointer position is not a time. Sending it anyway
    // would post NaN milliseconds and move the job to the epoch.
    if (!Number.isFinite(minute)) return;
    move(dragged, minuteToEpochMs(board.dayStartMs, minute), inspectorId);
  }

  // Dropping into the lane is an UNASSIGN, not a reschedule: the time the job
  // was pencilled in for is exactly what a dispatcher is still holding while
  // they look for someone to work it, so the instant is carried over unchanged.
  function dropOnLane(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setHover(null);
    setDraggingId(null);
    if (!dragged || !isDraggableItem(dragged)) return;
    const startMs = currentStartMs(dragged, board.dayStartMs);
    if (startMs == null) return;
    move(dragged, startMs, "");
  }

  const busy = fetcher.state !== "idle";

  return (
    <>
      <div
        className={`overflow-hidden rounded-lg border border-ih-border bg-ih-bg-card${busy ? " pointer-events-none opacity-60" : ""}`}
        aria-busy={busy}
      >
        {closures.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-ih-border bg-ih-bg-muted px-3 py-2">
            {closures.map((closure) => (
              <span
                key={closure.id}
                className="rounded-full bg-ih-fg-4 px-3 py-1 text-[11px] font-bold text-ih-fg-inverse"
              >
                {m.dispatch_closed_prefix()}: {closure.title}
              </span>
            ))}
          </div>
        )}

        <div className="flex">
          <UnassignedLane
            items={board.unassigned}
            draggingId={draggingId}
            onDragStartItem={setDraggingId}
            onDragEndItem={() => setDraggingId(null)}
            onDropItem={dropOnLane}
          />

          {board.inspectors.length === 0 ? (
            <div className="flex-1 p-6">
              <EmptyState
                title={m.dispatch_no_inspectors_title()}
                description={m.dispatch_no_inspectors_body()}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto" data-testid="dispatch-columns-scroller">
              <div className="flex min-w-max">
                <TimeGutter hours={hours} axisPx={axisPx} />
                {board.inspectors.map((inspector) => (
                  <InspectorColumn
                    key={inspector.id}
                    inspector={inspector}
                    items={board.items}
                    hours={hours}
                    axisPx={axisPx}
                    draggingId={draggingId}
                    hoverMinute={hover?.inspectorId === inspector.id ? hover.minute : null}
                    onDragStartItem={setDraggingId}
                    onDragEndItem={() => { setDraggingId(null); setHover(null); }}
                    onDragOverAxis={(minute) => setHover({ inspectorId: inspector.id, minute })}
                    onDragLeaveAxis={() => setHover(null)}
                    onDropAxis={(event) => dropOnColumn(inspector.id, event)}
                    slotIntervalMin={board.slotIntervalMin}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConflictModal
        open={blocked !== null}
        conflicts={blocked ?? []}
        onClose={() => setBlocked(null)}
      />
    </>
  );
}
