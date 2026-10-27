import { Button } from "@core/shared-ui";
import { useEditorCapabilities } from "../../hooks/useEditorCapabilities";
import { useReadOnly } from "../../read-only";
import { m } from "../../i18n";
import { BreadcrumbDropdown, type UnitScopeRow } from "./BreadcrumbDropdown";

const UNITS_ICON = (
  <svg className="w-3.5 h-3.5 text-ih-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);
const COST_ICON = (
  <svg className="w-3.5 h-3.5 text-ih-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.66 0-3 .9-3 2s1.34 2 3 2 3 .9 3 2-1.34 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 12v-2m0-10a4 4 0 100 8 4 4 0 000-8z" />
  </svg>
);

interface UnitControlsProps {
  isPerUnit: boolean;
  units: UnitScopeRow[];
  activeUnitId: string | null;
  onSelectScope: (id: string | null) => void;
  onOpenUnits: () => void;
  onOpenCostItems: () => void;
}

/**
 * The desktop header's per-unit cluster: the scope switcher (reading) and the Units and Cost Items buttons (each opens a
 * surface that edits, so a read-only editor does not offer them).
 */
export function UnitControls({ isPerUnit, units, activeUnitId, onSelectScope, onOpenUnits, onOpenCostItems }: UnitControlsProps) {
  const caps = useEditorCapabilities();
  const readOnly = useReadOnly();
  return (
    <div className="flex items-center gap-2">
      {isPerUnit && <BreadcrumbDropdown units={units} activeUnitId={activeUnitId} onSelect={onSelectScope} />}
      {!readOnly && (
        <Button variant="secondary" size="sm" onClick={onOpenUnits} className="hidden lg:inline-flex" title={m.editor_route_manage_units()} aria-label={m.editor_route_units()} icon={UNITS_ICON}>
          <span className="hidden min-[1700px]:inline">{m.editor_route_units()}</span>
        </Button>
      )}
      {!readOnly && caps.costItems && (
        <Button variant="secondary" size="sm" onClick={onOpenCostItems} className="hidden lg:inline-flex" title={m.editor_route_cost_items_title()} aria-label={m.editor_route_cost_items()} icon={COST_ICON}>
          <span className="hidden min-[1700px]:inline">{m.editor_route_cost_items()}</span>
        </Button>
      )}
    </div>
  );
}
