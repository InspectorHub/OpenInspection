import type { ReportSection, Severity, UnitMatrixRow } from "./types";

const SEVERITY_LABEL: Record<Severity, string> = {
  good: "Good",
  minor: "Minor",
  marginal: "Marginal",
  significant: "Significant",
};

const SEVERITY_CLASS: Record<Severity, string> = {
  good: "bg-ih-ok-bg text-ih-ok-fg",
  minor: "bg-ih-bg-muted text-ih-fg-2",
  marginal: "bg-ih-watch-bg text-ih-watch-fg",
  significant: "bg-ih-bad-bg text-ih-bad-fg",
};

/**
 * Exception Units — Detail (Commercial PCA Phase U). Expands the aggregate
 * condition of each EXCEPTION unit (any `significant` severity or any `safety`
 * finding) below the matrix, keeping the report bounded: only exception units
 * get their own block, so a 40-unit report stays legible.
 *
 * Detail is derived entirely from the already-threaded condition matrix — for
 * each exception unit we list only the sections that carry a finding (a non-null
 * worst severity OR any category count), showing the section title, a severity
 * pill, and its S/R/M category counts.
 *
 * DEFERRED (spec §6, out of scope for this batch): full per-unit individual-
 * defect-card sections (the optional "full mode" toggle). This renders the
 * aggregate exception detail only; the per-defect cards are a later toggle.
 *
 * Renders nothing when no unit is an exception (tagged/residential mode passes
 * an empty array, so the report is unchanged).
 */
export function UnitSections({
  rows,
  sections,
}: {
  rows: UnitMatrixRow[];
  sections: ReportSection[];
}) {
  const exceptions = rows.filter((r) => r.isException);
  if (exceptions.length === 0) return null;

  const sectionTitle = (id: string): string => sections.find((s) => s.id === id)?.title ?? id;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ih-fg-3">Exception Units — Detail</h2>
      <div className="space-y-3">
        {exceptions.map((unit) => {
          const findingSections = Object.entries(unit.cells).filter(
            ([, cell]) =>
              cell.worst !== null ||
              cell.counts.safety > 0 ||
              cell.counts.recommendation > 0 ||
              cell.counts.maintenance > 0,
          );
          return (
            <div key={unit.unitId} className="rounded-lg border border-ih-border bg-ih-bg-card p-4 print:break-inside-avoid">
              <h3 className="mb-3 font-semibold text-ih-fg-1">{unit.label}</h3>
              <ul className="space-y-2">
                {findingSections.map(([sectionId, cell]) => {
                  const { safety, recommendation, maintenance } = cell.counts;
                  return (
                    <li key={sectionId} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-ih-fg-2">{sectionTitle(sectionId)}</span>
                      {cell.worst !== null && (
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[cell.worst]}`}>
                          {SEVERITY_LABEL[cell.worst]}
                        </span>
                      )}
                      {(safety > 0 || recommendation > 0 || maintenance > 0) && (
                        <span className="flex gap-2 text-[11px] tabular-nums text-ih-fg-4">
                          {safety > 0 && <span>Safety: {safety}</span>}
                          {recommendation > 0 && <span>Recommendation: {recommendation}</span>}
                          {maintenance > 0 && <span>Maintenance: {maintenance}</span>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
