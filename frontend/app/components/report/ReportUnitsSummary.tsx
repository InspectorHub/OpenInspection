export interface ReportUnit {
  id: string;
  parentUnitId: string | null;
  kind: "building" | "floor" | "unit";
  type: "unit" | "common";
  name: string;
  sortOrder: number;
}

interface ReportUnitsSummaryProps {
  units: ReportUnit[];
  defectCountsByUnit?: Record<string, number>;
}

function childrenOf(units: ReportUnit[], parentId: string | null): ReportUnit[] {
  return units
    .filter((u) => u.parentUnitId === parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function ReportUnitsSummary({ units, defectCountsByUnit }: ReportUnitsSummaryProps) {
  if (!units || units.length === 0) return null;
  const counts = defectCountsByUnit ?? {};
  const buildings = childrenOf(units, null);

  return (
    <section className="max-w-3xl mx-auto px-4 mb-8">
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Property structure</h3>
        <ul className="space-y-3 text-sm">
          {buildings.map((building) => (
            <li key={building.id}>
              <a href={`#unit-${building.id}`} className="font-bold text-slate-900 hover:text-ih-primary">{building.name}</a>
              <ul className="ml-3 mt-1 space-y-1">
                {childrenOf(units, building.id).map((floor) => (
                  <li key={floor.id}>
                    <a href={`#unit-${floor.id}`} className="font-medium text-slate-700 hover:text-ih-primary">{floor.name}</a>
                    <ul className="ml-3 mt-1 space-y-1">
                      {childrenOf(units, floor.id).map((unit) => {
                        const count = counts[unit.id] ?? 0;
                        return (
                          <li key={unit.id} className="flex items-center gap-2">
                            <a href={`#unit-${unit.id}`} className="text-slate-600 hover:text-ih-primary">{unit.name}</a>
                            {count > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-ih-bad-bg text-ih-bad-fg text-[10px] font-bold">
                                {count} defect{count === 1 ? "" : "s"}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
