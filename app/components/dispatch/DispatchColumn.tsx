/**
 * The board's column primitives: the shared hour gutter, one inspector's
 * column, and the card that sits on it.
 *
 * Split out of `DispatchBoard.tsx` when that file crossed the 400-line gate.
 * The seam is deliberate rather than arbitrary — everything here is presentation
 * driven entirely by props, while the board keeps the state, the fetcher and
 * the drop decisions. Nothing in this file knows what a drop MEANS.
 */
import { Link } from "react-router";
import { m } from "~/paraglide/messages";
import {
  bucketColumn,
  cardGeometry,
  cardTone,
  hourLabel,
  inspectorLabel,
  isDraggableItem,
  minuteFromOffsetY,
  minuteToHm,
  offsetYFromMinute,
  HOUR_HEIGHT_PX,
  type DispatchInspector,
  type DispatchItem,
} from "./dispatch-helpers";

export function TimeGutter({ hours, axisPx }: { hours: number[]; axisPx: number }) {
  return (
    <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-ih-border bg-ih-bg-card">
      {/* Two spacers, not one: the gutter has to line up with BOTH the column
          heading and the all-day strip, or every card sits an all-day row off. */}
      <div className="h-10 border-b border-ih-border" />
      <div className="h-10 border-b border-ih-border pr-2 pt-2 text-right text-[10px] font-bold text-ih-fg-4">
        {m.calendar_all_day()}
      </div>
      <div className="relative" style={{ height: `${axisPx}px` }}>
        {hours.map((hour, index) => {
          const label = hourLabel(hour);
          return (
            /* fg-3, not the day calendar's fg-4: fg-4 measured 3.07:1 against
               the dark card surface, and an hour label is the one thing on this
               axis a reader must be able to resolve. */
            <div
              key={hour}
              className="absolute right-0 pr-2 text-[11px] font-bold text-ih-fg-3"
              style={{ top: `${index * HOUR_HEIGHT_PX}px` }}
            >
              {label.hour12}:00 {label.meridiem}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InspectorColumn({
  inspector,
  items,
  hours,
  axisPx,
  draggingId,
  hoverMinute,
  onDragStartItem,
  onDragEndItem,
  onDragOverAxis,
  onDragLeaveAxis,
  onDropAxis,
  slotIntervalMin,
}: {
  inspector: DispatchInspector;
  items: DispatchItem[];
  hours: number[];
  axisPx: number;
  draggingId: string | null;
  hoverMinute: number | null;
  onDragStartItem: (id: string) => void;
  onDragEndItem: () => void;
  onDragOverAxis: (minute: number) => void;
  onDragLeaveAxis: () => void;
  onDropAxis: (event: React.DragEvent<HTMLDivElement>) => void;
  slotIntervalMin: number;
}) {
  const { timed, untimed } = bucketColumn(items, inspector.id);

  return (
    <div
      className="w-56 shrink-0 border-r border-ih-border last:border-r-0"
      data-inspector-id={inspector.id}
      data-testid="dispatch-column"
    >
      <div className="flex h-10 items-center gap-2 border-b border-ih-border px-2">
        <span className="truncate text-[12px] font-bold text-ih-fg-1" title={inspectorLabel(inspector)}>
          {inspectorLabel(inspector)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-ih-fg-4">{timed.length + untimed.length}</span>
      </div>

      <div className="h-10 space-y-1 overflow-y-auto border-b border-ih-border p-1">
        {untimed.map((item) => (
          <div
            key={item.id}
            data-item-id={item.id}
            data-inspection-id={item.inspectionId ?? item.id}
            className={`truncate rounded px-2 py-0.5 text-[11px] font-bold ${cardTone(item.kind)}`}
          >
            {item.title}
          </div>
        ))}
      </div>

      <div
        className="relative"
        style={{ height: `${axisPx}px` }}
        data-dispatch-dropzone={inspector.id}
        onDragOver={(event) => {
          if (!draggingId) return;
          // Without preventDefault the browser refuses the drop outright — this
          // is what makes the element a drop target, not just a hover surface.
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onDragOverAxis(minuteFromOffsetY(event.clientY - rect.top, slotIntervalMin));
        }}
        onDragLeave={onDragLeaveAxis}
        onDrop={onDropAxis}
      >
        {hours.map((hour, index) => (
          <div
            key={hour}
            className="absolute inset-x-0 border-b border-ih-border"
            style={{ top: `${index * HOUR_HEIGHT_PX}px`, height: `${HOUR_HEIGHT_PX}px` }}
          />
        ))}

        {hoverMinute != null && (
          <div
            className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-dashed border-ih-primary"
            style={{ top: `${offsetYFromMinute(hoverMinute)}px` }}
            data-testid="dispatch-drop-indicator"
            data-drop-minute={hoverMinute}
          >
            <span className="ml-1 rounded bg-ih-primary px-1 text-[10px] font-bold text-ih-fg-inverse">
              {minuteToHm(hoverMinute)}
            </span>
          </div>
        )}

        {timed.length === 0 && untimed.length === 0 && (
          <p className="absolute inset-x-0 top-4 text-center text-[11px] text-ih-fg-4">
            {m.dispatch_empty_day()}
          </p>
        )}

        {timed.map((item) => (
          <DispatchCard
            key={item.id}
            item={item}
            dragging={draggingId === item.id}
            onDragStartItem={onDragStartItem}
            onDragEndItem={onDragEndItem}
          />
        ))}
      </div>
    </div>
  );
}

function DispatchCard({
  item,
  dragging,
  onDragStartItem,
  onDragEndItem,
}: {
  item: DispatchItem;
  dragging: boolean;
  onDragStartItem: (id: string) => void;
  onDragEndItem: () => void;
}) {
  const geometry = cardGeometry(item);
  if (!geometry) return null;
  const draggable = isDraggableItem(item);

  const body = (
    <>
      <span className="flex items-center gap-1">
        {draggable && (
          <span
            data-drag-handle
            aria-label={m.dispatch_card_grip()}
            className="cursor-grab select-none text-[11px] leading-none opacity-80"
          >
            ⠿
          </span>
        )}
        <span className="truncate">{item.title}</span>
      </span>
      <span className="mt-0.5 block truncate text-[10px] font-normal opacity-90">
        {item.startTime}
        {item.endTime ? `-${item.endTime}` : ""}
        {geometry.clippedStart ? ` ${m.dispatch_card_before_axis()}` : ""}
        {geometry.clippedEnd ? ` ${m.dispatch_card_after_axis()}` : ""}
      </span>
    </>
  );

  return (
    <div
      data-item-id={item.id}
      data-inspection-id={item.inspectionId ?? ""}
      data-testid="dispatch-card"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStartItem(item.id);
      }}
      onDragEnd={onDragEndItem}
      className={`absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-[11px] font-bold ${cardTone(item.kind)}${dragging ? " opacity-40" : ""}`}
      style={{ top: `${geometry.topPx}px`, height: `${geometry.heightPx}px` }}
    >
      {item.inspectionId ? (
        <Link to={`/inspections/${item.inspectionId}`} className="block hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
