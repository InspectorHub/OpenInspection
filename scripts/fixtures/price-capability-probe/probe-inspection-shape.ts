/**
 * FIXTURE (2 of 2) — the FIELDS, CONTROLS and RETIRED halves of the proof that
 * `scripts/check-price-capability.mjs` bites. `probe-schema.ts` carries the
 * COLUMNS half.
 *
 * Not compiled, not linted, not shipped: `scripts/**` is outside both tsconfig
 * programs and eslint's scope, and this directory is in knip's ignore list. The
 * gate reads source as TEXT, so nothing here has to resolve an import or render.
 *
 * Run:
 *   node scripts/check-price-capability.mjs --fixture scripts/fixtures/price-capability-probe
 *
 * Expected: exit 1, naming FOUR things —
 *   1. `probe_findings.repair_estimate_cents`   (COLUMNS, other file)
 *   2. `…probe-inspection-shape.ts#repairCostCents` (FIELDS)
 *   3. this file                                 (CONTROLS — a MoneyInput render)
 *   4. `estimateMinCents` / `estimateMaxCents`   (RETIRED)
 *
 * (4) is the material that matters most. Those two identifiers were a real
 * capability that was removed on purpose: a repair estimate on a canned comment
 * / repair item, which reached the report as the inspection company's own
 * figure. A ratchet that cannot be shown biting on the thing it was built for
 * is a ratchet nobody has tested.
 *
 * The NEGATIVE CONTROLS must NOT be reported, here or in `probe-schema.ts`.
 */
import { MoneyInput } from '~/components/MoneyInput';

/** POSITIVE: a money field entering the persisted inspection shape. */
export interface ProbeFindingEntry {
    repairCostCents?: number | null;

    // ── NEGATIVE CONTROLS ────────────────────────────────────────────────────
    severity?: string;
    notes?: string;
    photoCount?: number;
    /** Prose may say the word price; documentation is not a field. */
    description?: string;
}

/**
 * POSITIVE: the retired identifiers, on code lines rather than in prose. The
 * gate ignores comment lines, so naming a retired identifier while explaining
 * why it was retired does not trip it — only reintroducing it does.
 */
export interface ProbeCannedComment {
    text: string;
    estimateMinCents?: number | null;
    estimateMaxCents?: number | null;
}

/** POSITIVE: a new screen that lets somebody type an amount. */
export function ProbeRepairPricePanel() {
    return <MoneyInput cents={null} onChange={() => {}} ariaLabel="Repair cost" />;
}
