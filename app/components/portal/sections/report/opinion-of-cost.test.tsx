// @vitest-environment happy-dom
/**
 * §1.3 Opinion of Cost carries the numbers that were computed for it.
 *
 * A SEAM ASSIGNED IN A CIRCLE. Two plans each said the other would join it:
 *
 *   Phase C — "does not build the ES component… If Phase S has landed, wire
 *              `rollup` into its ES component; if not, the payload field stands
 *              ready and is covered by tests."
 *   Phase S — "§6 ES cost seam left empty for Phase C (`data-pca-cost-region`
 *              empty region; reconciliation tested in C, not here)."
 *
 * Both shipped their own half. `bucketRollup` computes the totals and
 * `buildCostTables` puts them in the payload; `PcaSkeleton` renders the slot as
 * an empty `aria-hidden` div. Nobody was ever going to do it later, because
 * each plan believed the other already had — which is how the field-level
 * census found it sitting unread.
 *
 * IT MATTERS BECAUSE THE BLOCK IS NOT DECORATIVE. ASTM E2018 §11.4 makes the
 * Opinion of Cost one of the Executive Summary's required sub-blocks, and it is
 * the figure a lender or buyer actually reads.
 *
 * THE LABELS ARE THE STATUTORY ONES. The three categories are Immediate /
 * Short-Term / Long-Term (§3.2.28 / §3.2.53 / §3.2.30). "Replacement Reserves"
 * is Fannie Mae's phrase, not ASTM's — the code's `reserveCents` is summed from
 * `bucket === 'long_term'` and must be labelled that way. Using the wrong word
 * here is the kind of thing a peer reviewer spots immediately.
 *
 * THE THRESHOLD IS DISCLOSED. §10.3.1 lets items under a threshold be omitted,
 * and `applyThreshold` reports how many were. A total that silently excludes
 * items is a total that misleads, so the count is stated beside it.
 *
 * MONEY OBEYS ONE GATE. `CostTables` opens with `if (!show || !data) return
 * null`, and this block honours the same flag. A report that hides estimates
 * must not leak them into the summary.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { OpinionOfCost } from "~/components/portal/sections/report/OpinionOfCost";

const ROLLUP = { immediateCents: 1_250_00, shortTermCents: 400_00, reserveCents: 9_000_00 };

describe("§1.3 Opinion of Cost summary", () => {
    it("states all three statutory totals", () => {
        render(<OpinionOfCost rollup={ROLLUP} droppedCount={0} show />);
        expect(screen.getByText(/\$1,250\.00/)).toBeTruthy();
        expect(screen.getByText(/\$400\.00/)).toBeTruthy();
        expect(screen.getByText(/\$9,000\.00/)).toBeTruthy();
    });

    // The third bucket is Long-Term in ASTM's own vocabulary. `reserveCents` is
    // the field name; "Reserve" must not be the label.
    it("names the third category Long-Term, not Reserve", () => {
        render(<OpinionOfCost rollup={ROLLUP} droppedCount={0} show />);
        expect(screen.getByText(/long-term/i)).toBeTruthy();
        expect(screen.queryByText(/reserve/i)).toBeNull();
    });

    it("discloses how many items the reporting threshold excluded", () => {
        render(<OpinionOfCost rollup={ROLLUP} droppedCount={4} show />);
        expect(screen.getByText(/4 item\(s\).*threshold/i)).toBeTruthy();
    });

    // POSITIVE CONTROL for the disclosure: it must be absent when nothing was
    // dropped, or the case above would pass against a line rendered always.
    it("says nothing about the threshold when nothing was excluded", () => {
        render(<OpinionOfCost rollup={ROLLUP} droppedCount={0} show />);
        expect(screen.queryByText(/threshold/i)).toBeNull();
    });

    // The one gate that governs every figure on this report.
    it("shows no money at all when the report hides estimates", () => {
        const { container } = render(<OpinionOfCost rollup={ROLLUP} droppedCount={4} show={false} />);
        expect(container.textContent).toBe("");
    });

    // Nothing costed yet is not the same as zero cost, and a table of three
    // "$0.00" rows says the inspector priced the building at nothing.
    it("renders nothing when there is no rollup", () => {
        const { container } = render(<OpinionOfCost rollup={null} droppedCount={0} show />);
        expect(container.textContent).toBe("");
    });
});
