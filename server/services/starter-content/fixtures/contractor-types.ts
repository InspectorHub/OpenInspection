import { DEFECT_TRADES, DEFECT_TRADE_LABELS, type DefectTrade } from '../../../types/defect-fields';

/**
 * The contractor-type taxonomy a fresh workspace starts with (#277).
 *
 * DERIVED from `DEFECT_TRADES`, not hand-copied. The list this replaced was ten
 * hand-written names with a comment saying they *"MUST stay in sync with the
 * contractor-type backfill in 0000_baseline.sql"* — a backfill that no longer
 * exists (it went in the #261 squash), pointing at a coupling nothing enforced.
 * Per the repo's Comment Rules a "must stay in sync" note becomes executable or
 * it becomes wrong; this is the executable version, and the seed can no longer
 * disagree with the vocabulary because it is computed from it.
 *
 * ⚠️ TWO KINDS OF ROW LIVE HERE, and the difference is the whole design.
 *
 *   - The 20 CANONICAL rows carry a `tradeSlug`. That is what survives a tenant
 *     renaming the display label, which `name` alone cannot.
 *   - The 2 EXTRA rows carry `tradeSlug: null`. They have no counterpart in the
 *     canonical vocabulary and they are still useful to an inspector, so NULL is
 *     a correct and PERMANENT state rather than a backfill gap. Deleting them
 *     would remove data existing tenants already use.
 *
 * ⚠️ Which means a test asserting "the seeded slug set equals DEFECT_TRADES" must
 * filter the NULLs first. Asserting it unfiltered is unsatisfiable together with
 * the extras existing — pick one, and the extras win because they are real data.
 */

export interface ContractorTypeSeed {
    name: string;
    sortOrder: number;
    /** NULL for a type with no canonical counterpart. Permanent, not pending. */
    tradeSlug: DefectTrade | null;
}

/**
 * Title-case a canonical label for display.
 *
 * `DEFECT_TRADE_LABELS` is lower case because it is rendered mid-sentence
 * ("recommend a licensed electrician"); a dropdown entry is a proper noun.
 *
 * ⚠️ A word that ALREADY contains an upper-case letter is left alone. Without
 * that, `HVAC technician` becomes `Hvac Technician` and `mold-remediation` loses
 * nothing but `HVAC` becomes wrong in a way nobody would notice in a diff.
 */
function displayName(label: string): string {
    return label
        .split(' ')
        .map((word) =>
            /[A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(' ');
}

/** The extras, kept because existing tenants have them and inspectors use them. */
const EXTRA_TYPES: ReadonlyArray<{ name: string }> = [
    { name: 'Foundation Specialist' },
    { name: 'Grading/Drainage' },
];

/**
 * Canonical rows in vocabulary order, then the extras.
 *
 * Order comes from `DEFECT_TRADES` so the dropdown matches the order a defect's
 * trade picker offers. Nothing re-sorts alphabetically: that would put
 * `Appliance Technician` above `General Contractor`, which is not the order an
 * inspector reaches for them in.
 */
export const CONTRACTOR_TYPES: ReadonlyArray<ContractorTypeSeed> = [
    ...DEFECT_TRADES.map((slug, i) => ({
        name: displayName(DEFECT_TRADE_LABELS[slug]),
        sortOrder: i + 1,
        tradeSlug: slug,
    })),
    ...EXTRA_TYPES.map((e, i) => ({
        name: e.name,
        sortOrder: DEFECT_TRADES.length + i + 1,
        tradeSlug: null,
    })),
];
