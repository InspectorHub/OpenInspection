/**
 * Design System 0520 subsystem D phase 3 — units summary on the report.
 *
 * Rendered above the section list when the inspection has any
 * `inspection_units` rows. Shows the building → floor → unit
 * hierarchy as a navigable card so customers can scan a multi-unit
 * property report at a glance, plus per-unit defect counts derived
 * from `items[].unitId`.
 *
 * Items without a unit_id continue to render inside the existing
 * section list — this card is additive, not a replacement. Full
 * per-unit item grouping is a follow-up; this is the entry-point
 * surface that proves the unit_id stamping is wired end to end.
 */
import type { FC } from 'hono/jsx';

export interface ReportUnit {
    id:           string;
    parentUnitId: string | null;
    kind:         'building' | 'floor' | 'unit';
    /** 'common' for shared areas (lobby, hallways); 'unit' for individual units. */
    type:         'unit' | 'common';
    name:         string;
    sortOrder:    number;
}

export interface ReportUnitsSummaryProps {
    units: ReportUnit[];
    /** Map of unitId → defect count. Missing keys render as 0. */
    defectCountsByUnit?: Record<string, number>;
}

/** Pure helper exported for unit testing — returns the direct children
 *  of `parentId` (use `null` for top-level buildings), sorted by
 *  `sortOrder`. Missing sortOrder treated as 0 so legacy rows render
 *  in insertion order. */
export function childrenOf(units: ReportUnit[], parentId: string | null): ReportUnit[] {
    return units
        .filter(u => u.parentUnitId === parentId)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export const ReportUnitsSummary: FC<ReportUnitsSummaryProps> = ({ units, defectCountsByUnit }) => {
    if (!units || units.length === 0) return <></>;
    const counts = defectCountsByUnit ?? {};
    const buildings = childrenOf(units, null);

    return (
        <section class="max-w-3xl mx-auto px-4 mb-8">
            <div class="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                    Property structure
                </h3>
                <ul class="space-y-3 text-sm">
                    {buildings.map(building => (
                        <li>
                            <a href={`#unit-${building.id}`}
                               class="font-bold text-slate-900 hover:text-indigo-600">
                                {building.name}
                            </a>
                            <ul class="ml-3 mt-1 space-y-1">
                                {childrenOf(units, building.id).map(floor => (
                                    <li>
                                        <a href={`#unit-${floor.id}`}
                                           class="font-medium text-slate-700 hover:text-indigo-600">
                                            {floor.name}
                                        </a>
                                        <ul class="ml-3 mt-1 space-y-1">
                                            {childrenOf(units, floor.id).map(unit => {
                                                const count = counts[unit.id] ?? 0;
                                                return (
                                                    <li class="flex items-center gap-2">
                                                        <a href={`#unit-${unit.id}`}
                                                           class="text-slate-600 hover:text-indigo-600">
                                                            {unit.name}
                                                        </a>
                                                        {count > 0 && (
                                                            <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-bold">
                                                                {count} defect{count === 1 ? '' : 's'}
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
};
