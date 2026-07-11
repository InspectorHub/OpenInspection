import { useRef, useState } from "react";
import { Popover } from "@core/shared-ui";

/**
 * Commercial PCA Phase U (Batch C2b) — a flat unit row as it arrives from
 * `GET /api/inspections/:id/units` (`data.units[]`). Only the fields the scope
 * switcher reads are required; the endpoint returns more (tenantId, attrs, …).
 */
export interface UnitScopeRow {
  id: string;
  name: string;
  /** 'building' | 'floor' | 'unit' — only 'unit' rows are selectable scopes. */
  kind?: string;
  /** 'unit' | 'common' — a common-area unit still scopes findings. */
  type?: string;
  parentUnitId?: string | null;
  sortOrder?: number;
}

export interface BreadcrumbDropdownProps {
  /** Flat unit rows (the loader's `units`). */
  units: UnitScopeRow[];
  /** The active scope: `null` = the shared Common scope, else a unit id. */
  activeUnitId: string | null;
  /** Fired with the chosen scope (`null` for Common). */
  onSelect: (unitId: string | null) => void;
}

const COMMON_LABEL = "Common";

/**
 * The SCOPE SWITCHER. Renders a breadcrumb-style pill naming the active scope
 * ("Common" or a unit) and, on click, a Popover listing Common + every unit.
 * Selecting one drives `activeUnitId` in the editor.
 *
 * Only `kind === 'unit'` rows are offered (mirrors the unit-progress server
 * filter); the always-present "Common" entry is the `_default` shared scope
 * (activeUnitId = null), not a DB row.
 */
export function BreadcrumbDropdown({ units, activeUnitId, onSelect }: BreadcrumbDropdownProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const scopes = units
    .filter((u) => (u.kind ?? "unit") === "unit")
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const active = activeUnitId ? scopes.find((u) => u.id === activeUnitId) : null;
  const activeLabel = active ? active.name : COMMON_LABEL;

  const choose = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Inspection scope: ${activeLabel}. Switch scope`}
        title="Switch inspection scope"
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-ih-button bg-ih-bg-muted text-ih-fg-2 text-[12px] font-bold hover:bg-ih-border max-w-[200px]"
      >
        <svg className="w-3.5 h-3.5 text-ih-fg-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6l8-3 8 3-8 3-8-3zM4 12l8 3 8-3M4 18l8 3 8-3" />
        </svg>
        <span className="truncate">{activeLabel}</span>
        <svg className="w-3 h-3 text-ih-fg-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="left">
        <ul role="listbox" aria-label="Inspection scope" className="py-1 min-w-[220px] max-h-[60vh] overflow-y-auto">
          <ScopeOption
            label={COMMON_LABEL}
            hint="Shared / common areas"
            selected={activeUnitId === null}
            onSelect={() => choose(null)}
          />
          {scopes.length > 0 && (
            <li aria-hidden className="mx-3 my-1 border-t border-ih-border" />
          )}
          {scopes.map((u) => (
            <ScopeOption
              key={u.id}
              label={u.name}
              hint={u.type === "common" ? "Common area" : undefined}
              selected={u.id === activeUnitId}
              onSelect={() => choose(u.id)}
            />
          ))}
        </ul>
      </Popover>
    </>
  );
}

function ScopeOption({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-ih-bg-muted ${
          selected ? "text-ih-primary font-bold" : "text-ih-fg-2"
        }`}
      >
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? "text-ih-primary" : "text-transparent"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {hint && <span className="block text-[11px] text-ih-fg-4 font-normal truncate">{hint}</span>}
        </span>
      </button>
    </li>
  );
}
