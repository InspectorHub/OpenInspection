import { useState } from "react";
import { Banner, Button, Card, RadioCardGroup } from "@core/shared-ui";

import { MIGRATION_BATCH_STATUS } from "../../../server/lib/status/migration-batch-status";
import { IMPORT_CONFLICT_POLICIES, type ImportConflictPolicy } from "~/lib/imports-types";
import { m } from "~/paraglide/messages";

/** The states a run can still be applied FROM, and the ones it can be taken back from. */
const CAN_APPLY: readonly string[] = [MIGRATION_BATCH_STATUS.STAGED];
const CAN_REVERT: readonly string[] = [
    MIGRATION_BATCH_STATUS.APPLIED,
    MIGRATION_BATCH_STATUS.PARTIALLY_APPLIED,
];

const POLICY_LABEL: Record<ImportConflictPolicy, () => string> = {
    skip: m.imports_policy_skip,
    overwrite: m.imports_policy_overwrite,
    per_row: m.imports_policy_per_row,
};

/**
 * What this run will do, and the button that does it.
 *
 * Four numbers side by side, and they add up. A screen that showed only the
 * problems could not tell "nothing is wrong" from "nothing was examined" — the
 * same reason the bundle format asserts its own counts equation.
 *
 * The disabled button's sentence comes from the SERVER and is printed verbatim.
 * Whether a run may go ahead depends on how many entries are unwritable AND on
 * the seat position, which is not on this screen at all; deriving it again from
 * the counts here would give the banner and the button two chances to disagree.
 *
 * Three states, not two. `applied` is not the only state past the Import button:
 * a run that has been taken back, abandoned or swept still has counts worth
 * reading, and an Import button on it posts to an endpoint that answers 409. The
 * lists are named rather than negated, so a state added to the lifecycle lands
 * in the third case — counts only — instead of quietly acquiring a live button.
 */
export function ImportStage({
    counts,
    blockedReason,
    status,
    undoUntil,
    busy,
    onApply,
    onRevert,
}: {
    counts: { total: number; ok: number; conflicts: number; problems: number };
    blockedReason: string | null;
    status: string;
    /**
     * The day the undo stops working, ALREADY FORMATTED, or null once this run's
     * entries are no longer kept. Formatted by the page, which is the one place
     * that knows the viewer's locale and that this is a civil day rather than an
     * instant.
     */
    undoUntil: string | null;
    busy: boolean;
    onApply: (policy: ImportConflictPolicy) => void;
    /** Handed up rather than acted on: an undo deletes real rows and is confirmed by the page. */
    onRevert: () => void;
}) {
    const [policy, setPolicy] = useState<ImportConflictPolicy>("skip");
    const canApply = CAN_APPLY.includes(status);
    const canRevert = CAN_REVERT.includes(status);

    return (
        <Card className="p-5 space-y-4">
            {/* A ledger line rather than four chips: the three buckets are
                exclusive and sum to the total, and the rules make that visible
                without a sentence claiming it. */}
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
                <Tally tone="text-ih-fg-1 font-bold" first>
                    {m.imports_summary_total({ count: String(counts.total) })}
                </Tally>
                <Tally tone="text-ih-ok-fg">
                    {m.imports_summary_ok({ count: String(counts.ok) })}
                </Tally>
                <Tally tone="text-ih-watch-fg">
                    {m.imports_summary_conflicts({ count: String(counts.conflicts) })}
                </Tally>
                <Tally tone="text-ih-bad-fg">
                    {m.imports_summary_problems({ count: String(counts.problems) })}
                </Tally>
            </dl>

            {/* Cards rather than a segmented control, and the reason is
                measurable: a segmented control paints its UNCHOSEN segments
                `text-ih-fg-3` on `bg-ih-bg-muted`, which composites to 4.34:1 at
                12px — under AA, and invisible to `lint:contrast`, which reads
                the stylesheet rather than the painted pixel. Two of the three
                answers here are always unchosen, and all three have to be read
                before one is picked. The control is also the honest one for the
                job: these are three different outcomes for somebody's existing
                records, not a view toggle. */}
            {canApply && counts.conflicts > 0 && (
                <RadioCardGroup
                    name="importConflictPolicy"
                    legend={m.imports_policy_title()}
                    value={policy}
                    onChange={(v) => setPolicy(v as ImportConflictPolicy)}
                    options={IMPORT_CONFLICT_POLICIES.map((p) => ({
                        value: p,
                        title: POLICY_LABEL[p](),
                    }))}
                />
            )}

            {canApply && (
                <div className="space-y-3">
                    {blockedReason && <Banner tone="warn">{blockedReason}</Banner>}
                    <Button
                        variant="primary"
                        disabled={busy || blockedReason !== null}
                        onClick={() => onApply(policy)}
                    >
                        {m.imports_apply()}
                    </Button>
                </div>
            )}

            {canRevert && (
                <div className="space-y-2">
                    {/* An expired undo is SAID to be expired. A button that
                        quietly disappeared would read as a product that forgot
                        it ever offered one. */}
                    <p className="text-[12px] text-ih-fg-2 max-w-[70ch]">
                        {undoUntil ? m.imports_undo_until({ date: undoUntil }) : m.imports_undo_expired()}
                    </p>
                    {undoUntil && (
                        <Button variant="secondary" disabled={busy} onClick={onRevert}>
                            {m.imports_revert()}
                        </Button>
                    )}
                </div>
            )}
        </Card>
    );
}

/** One number of the ledger, ruled off from the one before it. */
function Tally({
    tone,
    first = false,
    children,
}: {
    tone: string;
    first?: boolean;
    children: string;
}) {
    return (
        <dd className={`${tone} ${first ? "" : "border-l border-ih-border pl-4"}`}>{children}</dd>
    );
}
