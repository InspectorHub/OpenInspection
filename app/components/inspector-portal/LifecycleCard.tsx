import type { useFetcher } from "react-router";
import { Card, Button } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
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
 */
export function LifecycleCard({
    status,
    fetcher,
}: {
    status: string;
    /** The hub's complete-fieldwork fetcher, so the button reflects its state. */
    fetcher: ReturnType<typeof useFetcher>;
}) {
    const state = lifecycleState(status);
    const marking = fetcher.state !== "idle";

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
                    <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="complete" />
                        <Button type="submit" variant="secondary" size="sm" disabled={marking}>
                            {marking ? m.inspections_hub_lifecycle_marking() : m.inspections_hub_lifecycle_mark_complete()}
                        </Button>
                    </fetcher.Form>
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
