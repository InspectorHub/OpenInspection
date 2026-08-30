import { Banner, Button, Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { StatutoryUpdateImpact } from "../../../server/services/marketplace/statutory-update-impact";

/**
 * What an administrator is told before a statutory package is updated.
 *
 * ── TWO NUMBERS, AND THE REASSURING ONE IS NOT OPTIONAL ─────────────────────
 * Updating retires the workspace's current template. Inspections already under
 * way stay on the retired one -- their snapshots protect them -- and for most of
 * them that is entirely fine: their dates fall inside the superseded revision's
 * window and their form goes out exactly as it would have. So the dialog states
 * how many keep producing correctly BEFORE it states how many cannot. A
 * confirmation that only warned would talk somebody out of an update they
 * should make, and unnecessary alarm is as much a defect as a missed warning.
 *
 * ── THE NUMBERS ARE NOT COUNTED HERE ────────────────────────────────────────
 * They arrive from `statutoryUpdateImpact`, which asks `revisionStatus` -- the
 * same criterion as the editor banner and the reschedule response. A dialog
 * that counted by its own rule would show a number the banner contradicts, on
 * the same day, about the same inspection.
 *
 * ── ONE/MANY PAIRS, NOT ONE SENTENCE WITH A NUMBER IN IT ────────────────────
 * "1 of them are dated" is the sentence a single interpolation produces, and a
 * confirmation about official documents cannot afford to read as machine
 * output. Two keys per count, the way the picker's item counter already does it.
 *
 * ── A WITHDRAWN "FROM" REVISION IS A DIFFERENT DIALOG ───────────────────────
 * When the revision the workspace is leaving has been WITHDRAWN, the reassuring
 * number is zero by construction -- nothing produces from a withdrawn revision
 * -- so the two-number copy above would state something untrue. That case gets
 * its own body, and it names WHY the revision was withdrawn, because the two
 * causes leave different work behind: a wrong field map means the documents
 * already issued should be issued again once a corrected map ships, while an
 * authority's withdrawal leaves nothing to redo. One sentence for both would
 * either invent work or hide it.
 *
 * ── AND THERE IS NO MIGRATION OFFERED ───────────────────────────────────────
 * The blocked inspections' way out is being started again on the updated
 * template. Moving a half-entered inspection onto a newer revision would have
 * to decide what happens to answers somebody stood in a building to collect,
 * and every answer to that is worse than not asking.
 */
export function StatutoryUpdateConfirm({
    open,
    name,
    impact,
    submitting,
    failed = false,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    /** The catalogue entry's name, so the title names what is being changed. */
    name: string;
    /** `null` while the counts are still being read. */
    impact: StatutoryUpdateImpact | null;
    submitting: boolean;
    /** The counts could not be read. Nothing has been changed. */
    failed?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    // The counts ARE the content. Offering the button beside a blank space
    // would invite a decision made on no information at all.
    const ready = impact !== null && !failed;

    return (
        <Modal
            open={open}
            onClose={onCancel}
            title={m.statutory_update_confirm_title({ name })}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        {m.statutory_update_confirm_cancel()}
                    </Button>
                    {ready && (
                        <Button type="button" variant="primary" disabled={submitting} onClick={onConfirm}>
                            {m.statutory_update_confirm_submit()}
                        </Button>
                    )}
                </>
            }
        >
            {failed && <Banner tone="danger">{m.statutory_update_confirm_error()}</Banner>}
            {!failed && impact === null && (
                <p className="text-[13px] text-ih-fg-3">{m.statutory_update_confirm_loading()}</p>
            )}
            {ready && impact !== null && impact.fromWithdrawal !== null && (
                <div className="space-y-3">
                    {/* The ordinary two-number copy is not merely unhelpful here,
                        it is false: "N of them stay on revision X and still
                        produce their form" describes a revision that produces
                        nothing at all. So the withdrawal replaces it rather than
                        sitting beside it, and it names the reason, because the
                        two reasons leave an administrator with different work
                        after the update -- re-issuing what went out on a wrong
                        field map, or nothing further at all. */}
                    <Banner tone="warn">
                        {impact.fromWithdrawal.reason === "field_map_incorrect"
                            ? m.statutory_update_withdrawn_field_map({
                                version: impact.fromRevision ?? "",
                            })
                            : m.statutory_update_withdrawn_authority({
                                version: impact.fromRevision ?? "",
                            })}
                    </Banner>
                    {impact.total > 0 && (
                        <p className="text-[13px] text-ih-fg-2">
                            {impact.total === 1
                                ? m.statutory_update_withdrawn_inflight_one({
                                    version: impact.fromRevision ?? "",
                                })
                                : m.statutory_update_withdrawn_inflight_many({
                                    count: String(impact.total),
                                    version: impact.fromRevision ?? "",
                                })}
                        </p>
                    )}
                </div>
            )}
            {ready && impact !== null && impact.fromWithdrawal === null && (
                <div className="space-y-3">
                    {impact.total === 0 ? (
                        <p className="text-[13px] text-ih-fg-2">{m.statutory_update_none_inflight()}</p>
                    ) : (
                        <p className="text-[13px] text-ih-fg-2">
                            {impact.producible === 1
                                ? m.statutory_update_inflight_one({
                                    total: String(impact.total),
                                    version: impact.fromRevision ?? "",
                                })
                                : m.statutory_update_inflight_many({
                                    producible: String(impact.producible),
                                    total: String(impact.total),
                                    version: impact.fromRevision ?? "",
                                })}
                        </p>
                    )}
                    {impact.total > 0 && (
                        impact.blocked > 0 ? (
                            <Banner tone="warn">
                                {impact.blocked === 1
                                    ? m.statutory_update_blocked_one({ version: impact.toRevision ?? "" })
                                    : m.statutory_update_blocked_many({
                                        count: String(impact.blocked),
                                        version: impact.toRevision ?? "",
                                    })}
                            </Banner>
                        ) : (
                            <p className="text-[13px] text-ih-fg-3">{m.statutory_update_none_blocked()}</p>
                        )
                    )}
                </div>
            )}
        </Modal>
    );
}
