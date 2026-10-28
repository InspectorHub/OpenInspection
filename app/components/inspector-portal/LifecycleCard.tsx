import { useState } from "react";
import { Card, Button, Banner } from "@core/shared-ui";
import { ConfirmDialog } from "@core/field-ui/components/ConfirmDialog";
import { BlockHeading } from "./BlockHeading";
import { CancelInspectionModal } from "./CancelInspectionModal";
import { RestoreInspectionAction } from "~/components/RestoreInspectionAction";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { lifecycleState } from "~/lib/hub-blocks";
import { humanizeStatus, statusTone } from "~/lib/status";
import { m } from "~/paraglide/messages";

/**
 * The inspection's own lifecycle — independent of report publishing. "Mark
 * fieldwork complete" is the only producer of `completed`; it is advisory and
 * never a publish precondition.
 *
 * The card used to render its heading, its status pill, and then — for a
 * completed or cancelled inspection — nothing at all, because the button is
 * hidden in those states and nothing took its place. A title and a badge over
 * blank space reads as broken rather than finished, so each terminal state says
 * what it means: completed means the visit happened, cancelled means it will not.
 *
 * AND SO DOES RECOVERY (#81), for the same reason and one more: this is where
 * the mis-click happens. Restoring is NOT an undo — the fee and the refund are
 * ledger entries that already happened — so the control says "Restore to
 * scheduled" and its confirmation names both halves. See RestoreInspectionAction.
 *
 * CANCELLING LIVES HERE (#67) because this card is the inspection's lifecycle,
 * and cancelling is the other end of the same axis "Mark fieldwork complete"
 * moves along — the one that says the visit will not happen. It is offered only
 * in the `actionable` state: the two terminal states are already the answer.
 *
 * No role gate on the control beyond the one the endpoints have. `POST
 * /:id/cancel` mounts `requireRole('owner','manager','inspector')`, so an
 * inspector standing at a door nobody answered may cancel, and hiding the button
 * from them would be this page holding a second, stricter opinion than the
 * endpoint that enforces it. Office staff keep cancel and restore only where the
 * server allows them (a job that is unpaid and has not started) and never get
 * "Mark complete"; each verb has its own flag (see `hubAccess`), and a card with
 * no verb shows the status alone.
 */
export function LifecycleCard({
    status,
    inspectionId,
    canComplete = true,
    canCancel = true,
    canRestore = true,
}: {
    status: string;
    /** The order being cancelled — the quote and the cancel are both keyed on it. */
    inspectionId: string;
    /** False for a viewer the API refuses to mark the visit complete (office staff). */
    canComplete?: boolean;
    /** False when the API would refuse the cancel (office staff on a paid or started inspection). */
    canCancel?: boolean;
    /** False when the API would refuse the restore (office staff on one that had started). */
    canRestore?: boolean;
}) {
    const state = lifecycleState(status);
    // The card owns the complete-fieldwork submit: the guard refuses a second press in the same frame.
    const { submit, fetcher, busy: marking } = useGuardedSubmit<{ ok?: boolean; error?: string }>();
    // Shown while the settled answer is a failure. A new attempt leaves `idle`, which clears it until that
    // attempt settles, so an old message never sits beside a request that is already in flight.
    const completeError = fetcher.state === "idle" && fetcher.data?.ok === false
        ? (fetcher.data.error || m.inspections_hub_lifecycle_error())
        : null;
    const [cancelOpen, setCancelOpen] = useState(false);
    const [completeOpen, setCompleteOpen] = useState(false);

    return (
        <Card className="p-5">
            <BlockHeading
                title={m.inspections_hub_lifecycle_title()}
                pill={{ tone: statusTone(status), label: humanizeStatus(status) }}
            />
            {state === "actionable" ? (canComplete || canCancel) && (
                <>
                    {canComplete && <p className="text-[12px] text-ih-fg-3 mb-3">{m.inspections_hub_lifecycle_hint()}</p>}
                    {completeError && <Banner tone="danger" className="mb-3">{completeError}</Banner>}
                    {/* Secondary, and the shared Button rather than a hand-rolled
                        one. As a solid primary it was the loudest control on the
                        page while being, by its own contract above, advisory and
                        never a precondition — it outranked Publish report, which
                        is the irreversible one. */}
                    <div className="flex flex-wrap items-center gap-2">
                        {canComplete && (
                            <>
                            {/* Asks first, like the editor's "Finish fieldwork": the move is
                                advisory but a mis-tap on a phone would otherwise send it. The
                                guarded submit decides before the command goes out, so two
                                presses in one frame send one request. */}
                            <Button type="button" variant="secondary" size="sm" pending={marking} onClick={() => setCompleteOpen(true)}>
                                {marking ? m.inspections_hub_lifecycle_marking() : m.inspections_hub_lifecycle_mark_complete()}
                            </Button>
                            <ConfirmDialog
                                open={completeOpen}
                                title={m.editor_finish_fieldwork_confirm_title()}
                                message={m.editor_finish_fieldwork_confirm_body()}
                                confirmLabel={m.inspections_hub_lifecycle_mark_complete()}
                                tone="default"
                                busy={marking}
                                onConfirm={() => {
                                    submit({ intent: "complete" }, { method: "post" });
                                    setCompleteOpen(false);
                                }}
                                onCancel={() => setCompleteOpen(false)}
                            />
                            </>
                        )}
                        {/* A link-weight danger control: cancelling is rare and
                            irreversible, so it must be findable without competing
                            with the button beside it. */}
                        {canCancel && (
                            <Button
                                type="button"
                                variant="danger-link"
                                size="sm"
                                onClick={() => setCancelOpen(true)}
                            >
                                {m.inspections_hub_cancel_action()}
                            </Button>
                        )}
                    </div>
                    {/* Mounted only while open, so closing it discards the
                        chosen reason, the notes, the quote and any error. A
                        modal kept alive across closes reopens showing the last
                        attempt's failure over a quote nobody asked for again. */}
                    {cancelOpen && (
                        <CancelInspectionModal
                            open
                            inspectionId={inspectionId}
                            onClose={() => setCancelOpen(false)}
                        />
                    )}
                </>
            ) : state === "completed" ? (
                <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_lifecycle_done()}</p>
            ) : (
                /* THE CANCELLED STATE HAD NO WAY OUT (#81). Cancelling happens
                   on this card, and its terminal state said "nothing further is
                   scheduled" over blank space — while the only recovery in the
                   product sat on a hover-only dropdown on a different page,
                   which nobody who had just mis-clicked here would think to
                   look for. The axis this card owns runs both ways. */
                <div className="space-y-2">
                    <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_lifecycle_cancelled()}</p>
                    {canRestore && (
                        <>
                            <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_lifecycle_cancelled_recover()}</p>
                            <RestoreInspectionAction inspectionId={inspectionId} />
                        </>
                    )}
                </div>
            )}
        </Card>
    );
}
