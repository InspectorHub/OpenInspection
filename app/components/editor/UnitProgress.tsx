/**
 * Commercial PCA Phase U (Batch C2b) — per-unit completion indicator.
 *
 * Renders "<completed> / <total> units" plus one dot per unit (filled when the
 * unit is complete). Fed by the editor from `GET /api/inspections/:id/unit-progress`
 * (`{ units:[{unitId,rated,total}], … }`): a unit is complete when
 * `rated === total` (and `total > 0`). The editor maps that summary into the
 * `{ id, label }[]` + `completedUnitIds` shape below.
 */

import { IconButton } from "@core/shared-ui";

interface UnitProgressUnit {
  id: string;
  label: string;
}

export interface UnitProgressProps {
  /** Every per-unit scope (order = display order). */
  units: UnitProgressUnit[];
  /** Ids of units whose findings are fully rated (rated === total, total > 0). */
  completedUnitIds: string[];
  /** Optional — click a dot to switch the editor to that unit's scope. */
  onSelectUnit?: (unitId: string) => void;
  /** The currently-active unit id, highlighted with a ring. */
  activeUnitId?: string | null;
}

export function UnitProgress({ units, completedUnitIds, onSelectUnit, activeUnitId }: UnitProgressProps) {
  if (units.length === 0) return null;

  const done = new Set(completedUnitIds);
  const completed = units.filter((u) => done.has(u.id)).length;

  return (
    <div
      className="flex items-center gap-2 text-[12px] font-mono tabular-nums"
      aria-label={`${completed} of ${units.length} units complete`}
    >
      <span className="text-ih-fg-2">
        {completed}/{units.length} units
      </span>
      <div className="flex items-center gap-1">
        {units.map((u) => {
          const isDone = done.has(u.id);
          const isActive = activeUnitId != null && u.id === activeUnitId;
          const dotClass = `inline-block w-2 h-2 rounded-full ${isDone ? "bg-ih-ok" : "bg-ih-border"} ${
            isActive ? "ring-2 ring-inset ring-ih-primary" : ""
          }`;
          const title = `${u.label} — ${isDone ? "complete" : "in progress"}`;

          return onSelectUnit ? (
            <IconButton
              key={u.id}
              onClick={() => onSelectUnit(u.id)}
              title={title}
              aria-label={title}
              size="sm"
              className="w-auto h-auto p-0.5"
            >
              <span className={dotClass} />
            </IconButton>
          ) : (
            <span key={u.id} title={title} aria-label={title}>
              <span className={dotClass} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
