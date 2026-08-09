import { useState } from "react";
import type { useFetcher } from "react-router";
import { Card, Button } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { CancelInspectionModal } from "./CancelInspectionModal";
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
 * CANCELLING LIVES HERE (#67) because this card is the inspection's lifecycle,
 * and cancelling is the other end of the same axis "Mark fieldwork complete"
 * moves along — the one that says the visit will not happen. It is offered only
 * in the `actionable` state: the two terminal states are already the answer.
 *
 * No role gate on the control. `POST /:id/cancel` mounts
 * `requireRole('owner','manager','inspector')`, so an inspector standing at a
 * door nobody answered may cancel, and hiding the button from them would be
 * this page holding a second, stricter opinion than the endpoint that enforces
 * it.
 */
export function LifecycleCard({
    status,
    inspectionId,
    fetcher,
}: {
    status: string;
    /** The order being cancelled — the quote and the cancel are both keyed on it. */
    inspectionId: string;
    /** The hub's complete-fieldwork fetcher, so the button reflects its state. */
    fetcher: ReturnType<typeof useFetcher>;
}) {
    const state = lifecycleState(status);
    const marking = fetcher.state !== "idle";
    const [cancelOpen, setCancelOpen] = useState(false);

    return (
        <Card className="p-5">
            <BlockHeading
                title={m.inspections_hub_lifecycle_title()}
                pill={{ tone: statusTone(status), label: humanizeStatus(status) }}
            />
            {state === "actionable" ? (
                <>
                    <p className="text-[12px] text-ih-fg-3 mb-3">{m.inspections_hub_lifecycle_hint()}</p>
                    {/* Secondary, and the shared Button rather than a hand-rolled
                        one. As a solid primary it was the loudest control on the
                        page while being, by its own contract above, advisory and
                        never a precondition — it outranked Publish report, which
                        is the irreversible one. */}
                    <div className="flex flex-wrap items-center gap-2">
                        <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="complete" />
                            <Button type="submit" variant="secondary" size="sm" disabled={marking}>
                                {marking ? m.inspections_hub_lifecycle_marking() : m.inspections_hub_lifecycle_mark_complete()}
                            </Button>
                        </fetcher.Form>
                        {/* A link-weight danger control: cancelling is rare and
                            irreversible, so it must be findable without competing
                            with the button beside it. */}
                        <Button
                            type="button"
                            variant="danger-link"
                            size="sm"
                            onClick={() => setCancelOpen(true)}
                        >
                            {m.inspections_hub_cancel_action()}
                        </Button>
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
            ) : (
                <p className="text-[12px] text-ih-fg-3">
                    {state === "completed"
                        ? m.inspections_hub_lifecycle_done()
                        : m.inspections_hub_lifecycle_cancelled()}
                </p>
            )}
        </Card>
    );
}
