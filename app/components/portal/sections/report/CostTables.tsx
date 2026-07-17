import { formatDollars } from "~/lib/money";
import { m } from "~/paraglide/messages";
import type { CostTables as CT, Table1Row } from "./types";

/**
 * Commercial PCA Phase C — TABLE 1 (Opinion of Cost: Immediate + Short-Term)
 * and the opt-in TABLE 2 (Capital Replacement Reserve Schedule). Renders
 * nothing when costs are hidden or both tables are empty. No %-replace / code
 * columns (removed per the roadmap correction). Money via the shared
 * app/lib/money.ts formatDollars (whole dollars, cents shown only when present).
 * Wide reserve grid reuses the existing print
 * landscape/scaling.
 */
/** Commercial PCA Phase P/C seam — the reserve-row PHOTO NO. cell: an
 *  Appendix B anchor on screen, the bare "Photo N" in print/PDF (same
 *  print-flag convention as PhotoAppendix), nothing when unresolved. */
function PhotoNoCell({ photoNo, isPrint }: { photoNo: number | null | undefined; isPrint: boolean }) {
  if (photoNo == null) return null;
  if (isPrint) return <>{m.pca_cost_photo_ref({ n: photoNo })}</>;
  return <a href={`#photo-${photoNo}`} className="text-ih-primary hover:underline">{m.pca_cost_photo_ref({ n: photoNo })}</a>;
}

export function CostTables({ data, show, isPrint = false }: { data: CT | null; show: boolean; isPrint?: boolean }) {
  if (!show || !data) return null;
  const { table1, reserveSchedule } = data;
  const hasTable1 = table1.immediate.length > 0 || table1.shortTerm.length > 0;
  if (!hasTable1 && !reserveSchedule) return null;

  const Row = ({ r }: { r: Table1Row }) => (
    <tr className="border-b border-ih-border">
      <td className="py-1 pr-4">{r.item.component}{r.item.location ? ` — ${r.item.location}` : ""}</td>
      <td className="py-1 pr-4 text-right">{r.item.quantity ?? ""}</td>
      <td className="py-1 pr-4">{r.item.uom ?? ""}</td>
      <td className="py-1 pr-4 text-right">{r.item.unitCostCents != null ? formatDollars(r.item.unitCostCents) : ""}</td>
      <td className="py-1 pr-4 text-right">{r.item.bucket === "immediate" ? formatDollars(r.total) : ""}</td>
      <td className="py-1 pr-4 text-right">{r.item.bucket === "short_term" ? formatDollars(r.total) : ""}</td>
      <td className="py-1 text-ih-fg-3">{r.item.suggestedRemedy}</td>
    </tr>
  );

  return (
    <section className="mt-8 print:break-inside-avoid">
      {hasTable1 && (
        <div className="mb-8">
          <h2 className="mb-2 text-base font-semibold text-ih-fg-1">{m.pca_cost_table1_title()}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ih-border text-left text-xs uppercase tracking-wide text-ih-fg-3">
                <th className="py-1 pr-4">{m.pca_cost_col_item()}</th><th className="py-1 pr-4 text-right">{m.pca_cost_col_qty()}</th>
                <th className="py-1 pr-4">{m.pca_cost_col_unit()}</th><th className="py-1 pr-4 text-right">{m.pca_cost_col_unit_cost()}</th>
                <th className="py-1 pr-4 text-right">{m.pca_cost_col_immediate()}</th><th className="py-1 pr-4 text-right">{m.pca_cost_col_short_term()}</th>
                <th className="py-1">{m.pca_cost_col_comments()}</th>
              </tr>
            </thead>
            <tbody>
              {table1.immediate.map((r) => <Row key={r.item.id} r={r} />)}
              {table1.shortTerm.map((r) => <Row key={r.item.id} r={r} />)}
            </tbody>
            <tfoot>
              <tr className="font-medium text-ih-fg-1">
                <td className="pt-2" colSpan={4}>{m.pca_cost_totals()}</td>
                <td className="pt-2 text-right">{formatDollars(table1.immediateTotalCents)}</td>
                <td className="pt-2 text-right">{formatDollars(table1.shortTermTotalCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {reserveSchedule && (
        <div className="overflow-x-auto print:overflow-visible">
          <h2 className="mb-2 text-base font-semibold text-ih-fg-1">{m.pca_cost_reserve_title()}</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ih-border text-left uppercase tracking-wide text-ih-fg-3">
                <th className="py-1 pr-3">{m.pca_cost_col_item()}</th><th className="py-1 pr-2 text-right">{m.pca_cost_col_eul()}</th>
                <th className="py-1 pr-2 text-right">{m.pca_cost_col_eff_age()}</th><th className="py-1 pr-2 text-right">{m.pca_cost_col_rul()}</th>
                <th className="py-1 pr-3">{m.pca_cost_col_photo_no()}</th>
                {reserveSchedule.years.map((y) => <th key={y} className="py-1 pr-2 text-right">{y}</th>)}
                <th className="py-1 text-right">{m.pca_cost_col_total()}</th>
              </tr>
            </thead>
            <tbody>
              {reserveSchedule.rows.map((row) => (
                <tr key={row.item.id} className="border-b border-ih-border">
                  <td className="py-1 pr-3">{row.item.component}</td>
                  <td className="py-1 pr-2 text-right">{row.item.eul ?? ""}</td>
                  <td className="py-1 pr-2 text-right">{row.item.effAge ?? ""}</td>
                  <td className="py-1 pr-2 text-right">{row.item.rul ?? ""}</td>
                  <td className="py-1 pr-3"><PhotoNoCell photoNo={row.photoNo} isPrint={isPrint} /></td>
                  {reserveSchedule.years.map((y) => (
                    <td key={y} className="py-1 pr-2 text-right">
                      {y === row.placementYear ? formatDollars(row.replacementCents) : ""}
                    </td>
                  ))}
                  <td className="py-1 text-right">{formatDollars(row.replacementCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-ih-fg-1">
              <tr className="font-medium">
                <td className="pt-2" colSpan={5}>{m.pca_cost_total_uninflated()}</td>
                {reserveSchedule.uninflatedByYear.map((c, i) => <td key={i} className="pt-2 pr-2 text-right">{formatDollars(c)}</td>)}
                <td className="pt-2 text-right">{formatDollars(reserveSchedule.totalUninflatedCents)}</td>
              </tr>
              <tr className="font-medium">
                <td className="pt-1" colSpan={5}>{m.pca_cost_cumulative_inflated()}</td>
                {reserveSchedule.cumulativeInflatedByYear.map((c, i) => <td key={i} className="pt-1 pr-2 text-right">{formatDollars(c)}</td>)}
                <td className="pt-1 text-right">{formatDollars(reserveSchedule.totalInflatedCents)}</td>
              </tr>
              {reserveSchedule.perSfUninflatedAllYears != null && (
                <tr className="font-medium">
                  <td className="pt-1" colSpan={5}>{m.pca_cost_per_sf_uninflated_all()}</td>
                  {reserveSchedule.years.map((y) => <td key={y} className="pt-1 pr-2" />)}
                  <td className="pt-1 text-right">{formatDollars(reserveSchedule.perSfUninflatedAllYears)}</td>
                </tr>
              )}
              {reserveSchedule.perSfInflatedAllYears != null && (
                <tr className="font-medium">
                  <td className="pt-1" colSpan={5}>{m.pca_cost_per_sf_inflated_all()}</td>
                  {reserveSchedule.years.map((y) => <td key={y} className="pt-1 pr-2" />)}
                  <td className="pt-1 text-right">{formatDollars(reserveSchedule.perSfInflatedAllYears)}</td>
                </tr>
              )}
              {reserveSchedule.perSfInflatedPerYear != null && (
                <tr className="font-medium">
                  <td className="pt-1" colSpan={5}>{m.pca_cost_per_sf_inflated_per_year()}</td>
                  {reserveSchedule.years.map((y) => <td key={y} className="pt-1 pr-2" />)}
                  <td className="pt-1 text-right">{formatDollars(reserveSchedule.perSfInflatedPerYear)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
