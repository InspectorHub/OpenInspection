import type { ReportSection, Severity, UnitMatrixRow } from "./types";

/* Severity → label + token class. Reuses the exact mapping from the sibling
   SystemsSummaryTable (Phase S) so the per-unit matrix reads as one system with
   the systems-summary table. ih-* tokens only; dark-mode-safe. */
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
 * Unit Condition Matrix (Commercial PCA Phase U) — the default per-unit report
 * view. One row per inspected unit; one column per section/system. Each cell
 * shows the unit's worst condition severity in that section plus a compact
 * S/R/M category-count line (safety / recommendation / maintenance), rendered
 * only for non-zero categories. This keeps a 40-unit × many-section report
 * bounded to a single legible grid.
 *
 * Exception units (any `significant` severity or any `safety` finding) get a
 * left accent border + an "Exception" flag so they stand out; their aggregate
 * detail is expanded below the matrix by <UnitSections>.
 *
 * Renders nothing when there are no unit rows (tagged/residential mode passes
 * an empty array, so the report is unchanged).
 */
export function UnitConditionMatrix({
  rows,
  sections,
  defectCounts,
}: {
  rows: UnitMatrixRow[];
  sections: ReportSection[];
  defectCounts: Record<string, number>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6 print:break-inside-avoid">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ih-fg-3">Unit Condition Matrix</h2>
      {/* Wide grid: scroll inside its own container so a many-section matrix
          never forces the page body to scroll horizontally. */}
      <div className="overflow-x-auto rounded-lg border border-ih-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ih-border text-left text-ih-fg-3">
              <th className="whitespace-nowrap px-3 py-2 font-medium">Unit</th>
              {sections.map((s) => (
                <th key={s.id} className="whitespace-nowrap px-3 py-2 font-medium">{s.title}</th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Defects</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.unitId}
                className={`border-b border-ih-border last:border-0 ${row.isException ? "border-l-4 border-l-ih-bad" : ""}`}
              >
                <td className="whitespace-nowrap px-3 py-2 align-top text-ih-fg-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.label}</span>
                    {row.isException && (
                      <span className="rounded bg-ih-bad-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ih-bad-fg">
                        Exception
                      </span>
                    )}
                  </div>
                </td>
                {sections.map((s) => {
                  const cell = row.cells[s.id];
                  if (!cell || cell.worst === null) {
                    return (
                      <td key={s.id} className="px-3 py-2 align-top text-ih-fg-4" aria-label="No findings">
                        —
                      </td>
                    );
                  }
                  const { safety, recommendation, maintenance } = cell.counts;
                  return (
                    <td key={s.id} className="px-3 py-2 align-top">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[cell.worst]}`}>
                        {SEVERITY_LABEL[cell.worst]}
                      </span>
                      {(safety > 0 || recommendation > 0 || maintenance > 0) && (
                        <div className="mt-1 flex gap-1.5 text-[10px] tabular-nums text-ih-fg-4">
                          {safety > 0 && <span>S:{safety}</span>}
                          {recommendation > 0 && <span>R:{recommendation}</span>}
                          {maintenance > 0 && <span>M:{maintenance}</span>}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right align-top tabular-nums text-ih-fg-2">
                  {defectCounts[row.unitId] ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
