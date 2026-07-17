import { m } from "~/paraglide/messages";
import type { SystemsSummaryRow } from "./types";

const SEVERITY_CLASS: Record<SystemsSummaryRow["worstSeverity"], string> = {
  good: "bg-ih-ok-bg text-ih-ok-fg",
  minor: "bg-ih-bg-muted text-ih-fg-2",
  marginal: "bg-ih-watch-bg text-ih-watch-fg",
  significant: "bg-ih-bad-bg text-ih-bad-fg",
};

/**
 * Systems Summary Table (Commercial PCA Phase S) — a matrix: one row per
 * system, showing the worst condition severity + per-category finding counts.
 * Reads the Phase F severity + category axes (aggregated server-side by
 * buildSystemsSummary). Renders nothing when there are no systems.
 */
export function SystemsSummaryTable({ rows }: { rows: SystemsSummaryRow[] }) {
  if (!rows.length) return null;
  const SEVERITY_LABEL: Record<SystemsSummaryRow["worstSeverity"], string> = {
    good: m.pca_severity_good(),
    minor: m.pca_severity_minor(),
    marginal: m.pca_severity_marginal(),
    significant: m.pca_severity_significant(),
  };
  return (
    <section className="mb-6 print:break-inside-avoid">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ih-fg-3">{m.pca_systems_summary_title()}</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ih-border text-left text-ih-fg-3">
            <th className="py-2 pr-4 font-medium">{m.pca_systems_col_system()}</th>
            <th className="py-2 pr-4 font-medium">{m.pca_systems_col_condition()}</th>
            <th className="py-2 pr-4 font-medium text-right">{m.pca_systems_col_safety()}</th>
            <th className="py-2 pr-4 font-medium text-right">{m.pca_systems_col_recommendation()}</th>
            <th className="py-2 font-medium text-right">{m.pca_systems_col_maintenance()}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.systemId} className="border-b border-ih-border last:border-0">
              <td className="py-2 pr-4 text-ih-fg-1">{r.systemTitle}</td>
              <td className="py-2 pr-4">
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[r.worstSeverity]}`}>
                  {SEVERITY_LABEL[r.worstSeverity]}
                </span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-ih-fg-2">{r.counts.safety}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-ih-fg-2">{r.counts.recommendation}</td>
              <td className="py-2 text-right tabular-nums text-ih-fg-2">{r.counts.maintenance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
