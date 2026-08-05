import { Link } from "react-router";
import { EmptyState } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { UnassignedLane } from "./UnassignedLane";
import {
  axisHeightPx,
  boardHours,
  bucketColumn,
  cardGeometry,
  cardTone,
  closureItems,
  hourLabel,
  inspectorLabel,
  HOUR_HEIGHT_PX,
  type DispatchInspector,
  type DispatchItem,
  type DispatchPayload,
} from "./dispatch-helpers";

/**
 * The dispatch board: one column per schedulable person, one shared time axis,
 * and the unassigned lane pinned to the left.
 *
 * Read-only in this task. Every card already carries the identifiers a drop
 * handler needs (`data-item-id`, `data-inspection-id`, the owning column's
 * `data-inspector-id`), so drag-drop lands as behavior rather than as a rebuild.
 *
 * Columns are a horizontal scroller with a fixed minimum width instead of a
 * fluid grid: a company with nine inspectors would otherwise get nine 90px
 * columns, and a card that cannot show its address is not a card. The gutter
 * sticks to the left edge so the hour a card sits on stays readable at any
 * scroll offset.
 */
export function DispatchBoard({ board }: { board: DispatchPayload }) {
  const hours = boardHours();
  const closures = closureItems(board.items);
  const axisPx = axisHeightPx();

  return (
    <div className="overflow-hidden rounded-lg border border-ih-border bg-ih-bg-card">
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
        <UnassignedLane items={board.unassigned} />

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
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimeGutter({ hours, axisPx }: { hours: number[]; axisPx: number }) {
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

function InspectorColumn({
  inspector,
  items,
  hours,
  axisPx,
}: {
  inspector: DispatchInspector;
  items: DispatchItem[];
  hours: number[];
  axisPx: number;
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
            data-sortable-item
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
      >
        {hours.map((hour, index) => (
          <div
            key={hour}
            className="absolute inset-x-0 border-b border-ih-border"
            style={{ top: `${index * HOUR_HEIGHT_PX}px`, height: `${HOUR_HEIGHT_PX}px` }}
          />
        ))}

        {timed.length === 0 && untimed.length === 0 && (
          <p className="absolute inset-x-0 top-4 text-center text-[11px] text-ih-fg-4">
            {m.dispatch_empty_day()}
          </p>
        )}

        {timed.map((item) => (
          <DispatchCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function DispatchCard({ item }: { item: DispatchItem }) {
  const geometry = cardGeometry(item);
  if (!geometry) return null;

  const body = (
    <>
      <span className="flex items-center gap-1">
        <span
          data-drag-handle
          aria-label={m.dispatch_card_grip()}
          className="cursor-grab select-none text-[11px] leading-none opacity-80"
        >
          ⠿
        </span>
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
      data-sortable-item
      data-item-id={item.id}
      data-inspection-id={item.inspectionId ?? ""}
      data-testid="dispatch-card"
      className={`absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-[11px] font-bold ${cardTone(item.kind)}`}
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
