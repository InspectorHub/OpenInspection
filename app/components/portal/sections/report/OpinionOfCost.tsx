import { formatCents } from "~/lib/money";
import { m } from "~/paraglide/messages";
import type { BucketRollup } from "./types";

/**
 * The Executive Summary's §1.3 cost figures.
 *
 * A SEAM ASSIGNED IN A CIRCLE, which is why this arrived late. The Phase C plan
 * says it "does not build the ES component… if Phase S has landed, wire
 * `rollup` into its ES component"; the Phase S plan says the "ES cost seam
 * [is] left empty for Phase C". Both shipped their own half — the totals are
 * computed by `bucketRollup` and put in the payload by `buildCostTables`, and
 * the slot was rendered as an empty `aria-hidden` div — and the join belonged
 * to nobody. Nothing was going to fix that on its own, because each plan
 * believed the other already had.
 *
 * ASTM E2018 §11.4 makes the Opinion of Cost a required Executive Summary
 * sub-block, and it is the figure a lender or a buyer actually reads.
 *
 * THE LABELS ARE ASTM'S, NOT THE FIELD NAMES'. The three statutory categories
 * are Immediate, Short-Term and Long-Term (§3.2.28 / §3.2.53 / §3.2.30).
 * "Replacement Reserves" is Fannie Mae's phrase; `reserveCents` carries the
 * sum of `bucket === 'long_term'` and is labelled Long-Term here, because using
 * the wrong word is what a peer reviewer notices first.
 */
export function OpinionOfCost({
    rollup,
    droppedCount,
    show,
}: {
    rollup: BucketRollup | null;
    /**
     * How many line items `applyThreshold` left out under §10.3.1. Stated
     * beside the totals: a figure that silently excludes items is a figure
     * that misleads, and the threshold is disclosable.
     */
    droppedCount: number;
    /**
     * The report's one money gate — the same flag `CostTables` opens with. A
     * report that hides estimates must not leak them into its summary.
     */
    show: boolean;
}) {
    if (!show || !rollup) return null;

    const rows: { label: string; cents: number }[] = [
        { label: m.pca_cost_col_immediate(), cents: rollup.immediateCents },
        { label: m.pca_cost_col_short_term(), cents: rollup.shortTermCents },
        { label: m.pca_cost_es_long_term(), cents: rollup.reserveCents },
    ];

    return (
        <div className="text-sm">
            <table className="w-full max-w-md">
                <caption className="sr-only">{m.pca_cost_es_total()}</caption>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.label} className="border-b border-ih-border">
                            <th scope="row" className="py-1 pr-4 text-left font-normal text-ih-fg-3">
                                {r.label}
                            </th>
                            <td className="py-1 text-right font-medium text-ih-fg-1 tabular-nums">
                                {formatCents(r.cents)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {droppedCount > 0 && (
                <p className="mt-2 text-[12px] text-ih-fg-3">
                    {m.pca_cost_es_excluded({ count: droppedCount })}
                </p>
            )}
        </div>
    );
}
