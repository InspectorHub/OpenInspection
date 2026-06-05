import { useState, useRef, useEffect, useMemo } from "react";

export interface UnitItem {
  id: string;
  name: string;
  type: "common" | "individual";
  buildingId?: string | null;
}

export interface BuildingItem {
  id: string;
  name: string;
}

interface BreadcrumbDropdownProps {
  buildings: BuildingItem[];
  units: UnitItem[];
  activeBuildingId?: string | null;
  activeUnitId?: string | null;
  onSelectBuilding?: (id: string) => void;
  onSelectUnit?: (id: string) => void;
  onAddUnit?: (type: "building" | "unit" | "common", parentId: string | null) => void;
  onRenameUnit?: (id: string, name: string) => void;
  onRemoveUnit?: (id: string) => void;
  onDuplicateUnit?: (id: string) => void;
}

export function BreadcrumbDropdown({
  buildings,
  units,
  activeBuildingId,
  activeUnitId,
  onSelectBuilding,
  onSelectUnit,
  onAddUnit,
  onRenameUnit,
  onRemoveUnit,
  onDuplicateUnit,
}: BreadcrumbDropdownProps) {
  const [bldgOpen, setBldgOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const bldgRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bldgRef.current && !bldgRef.current.contains(e.target as Node)) setBldgOpen(false);
      if (unitRef.current && !unitRef.current.contains(e.target as Node)) setUnitOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const commonUnits = useMemo(() => units.filter((u) => u.type === "common"), [units]);
  const regularUnits = useMemo(() => units.filter((u) => u.type === "individual"), [units]);
  const activeUnit = units.find((u) => u.id === activeUnitId);
  const activeBuilding = buildings.find((b) => b.id === activeBuildingId);

  if (!units.length) return null;

  return (
    <div className="flex items-center gap-1 text-[13px]">
      <span className="text-ih-fg-5 mx-0.5">/</span>

      {/* Building segment */}
      {buildings.length > 0 && (
        <>
          <div className="relative" ref={bldgRef}>
            <button
              type="button"
              onClick={() => setBldgOpen(!bldgOpen)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
            >
              <span className="truncate max-w-[140px]">{activeBuilding?.name ?? "Building"}</span>
              <svg className="w-3 h-3 flex-shrink-0 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {bldgOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover z-50 overflow-hidden">
                <div className="max-h-[380px] overflow-y-auto py-1">
                  {buildings.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => { onSelectBuilding?.(b.id); setBldgOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors group ${activeBuildingId === b.id ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-3 hover:bg-ih-bg-muted/50"}`}
                    >
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="hidden group-hover:flex items-center gap-1">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onRenameUnit?.(b.id, b.name); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-primary" title="Rename">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveUnit?.(b.id); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-bad-fg" title="Remove">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="border-t border-ih-border px-3 py-2">
                  <button
                    type="button"
                    onClick={() => { onAddUnit?.("building", null); setBldgOpen(false); }}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ih-primary hover:underline"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    Add building
                  </button>
                </div>
              </div>
            )}
          </div>
          <span className="text-ih-fg-5 mx-0.5">/</span>
        </>
      )}

      {/* Unit segment */}
      <div className="relative" ref={unitRef}>
        <button
          type="button"
          onClick={() => setUnitOpen(!unitOpen)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
        >
          {activeUnit?.type === "common" && (
            <span className="px-1 py-0 rounded text-[8px] font-extrabold uppercase tracking-[0.05em] mr-0.5" style={{ background: "rgba(245,158,11,0.16)", color: "#b45309" }}>Common</span>
          )}
          <span className="truncate max-w-[140px]">{activeUnit?.name ?? "Unit"}</span>
          <svg className="w-3 h-3 flex-shrink-0 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {unitOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover z-50 overflow-hidden">
            <div className="max-h-[380px] overflow-y-auto py-1">
              {commonUnits.length > 0 && (
                <div>
                  <div className="ih-eyebrow px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Common areas</div>
                  {commonUnits.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { onSelectUnit?.(u.id); setUnitOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors group ${activeUnitId === u.id ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-3 hover:bg-ih-bg-muted/50"}`}
                    >
                      <span className="px-1 py-0 rounded text-[8px] font-extrabold uppercase tracking-[0.05em]" style={{ background: "rgba(245,158,11,0.16)", color: "#b45309" }}>Common</span>
                      <span className="flex-1 truncate">{u.name}</span>
                      <span className="hidden group-hover:flex items-center gap-1">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onRenameUnit?.(u.id, u.name); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-primary" title="Rename">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicateUnit?.(u.id); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-primary" title="Duplicate">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveUnit?.(u.id); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-bad-fg" title="Remove">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {regularUnits.length > 0 && (
                <div>
                  <div className="ih-eyebrow px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Individual units</div>
                  {regularUnits.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { onSelectUnit?.(u.id); setUnitOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors group ${activeUnitId === u.id ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-3 hover:bg-ih-bg-muted/50"}`}
                    >
                      <span className="flex-1 truncate">{u.name}</span>
                      <span className="hidden group-hover:flex items-center gap-1">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onRenameUnit?.(u.id, u.name); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-primary" title="Rename">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicateUnit?.(u.id); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-primary" title="Duplicate">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveUnit?.(u.id); }} className="w-5 h-5 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-bad-fg" title="Remove">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-ih-border px-3 py-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => { onAddUnit?.("unit", activeBuildingId ?? null); setUnitOpen(false); }}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ih-primary hover:underline"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add unit
              </button>
              <button
                type="button"
                onClick={() => { onAddUnit?.("common", activeBuildingId ?? null); setUnitOpen(false); }}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold hover:underline"
                style={{ color: "#b45309" }}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add common area
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
