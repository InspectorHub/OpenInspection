import { useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";
import type { action as restoreAction } from "~/routes/resources/inspection-restore";

const RESTORE_ROUTE = "/resources/inspection-restore";

/**
 * Bring a mis-cancelled inspection back (#81).
 *
 * ONE COMPONENT, TWO SURFACES, because it is one decision. Recovery used to
 * exist only on the `/inspections` list row's status dropdown, while people
 * cancel from the inspection hub's Lifecycle card — so the surface that took
 * the mis-click was the one surface with no way out of it. Rendering the same
 * component in both places is what keeps the confirmation, the wording and the
 * write path from drifting into two half-answers.
 *
 * ⚠️ IT IS NOT AN UNDO, AND THE CONFIRMATION SAYS SO. The inspection returns to
 * `scheduled` and the recorded cancellation reason is cleared. The fee that was
 * kept and the refund that was issued already happened — they are ledger
 * entries, reversed by an invoice adjustment and by nothing on this screen.
 * Copy that promised a clean undo would be the more comfortable sentence and
 * the false one, so both halves are stated together, always.
 *
 * `tone="danger"` is deliberately NOT used on the dialog: restoring destroys
 * nothing, and dressing it in the delete dialog's red would push people away
 * from the correction they came here to make.
 */
export function RestoreInspectionAction({
    inspectionId,
    variant = "secondary",
    className,
}: {
    inspectionId: string;
    variant?: "secondary" | "ghost";
    /** Only for fitting the trigger to a host row's control height. */
    className?: string;
}) {
    const fetcher = useFetcher<typeof restoreAction>();
    const [confirming, setConfirming] = useState(false);

    const busy = fetcher.state !== "idle";
    const result = fetcher.state === "idle" ? fetcher.data : undefined;
    const error = result && !result.ok ? result.error : undefined;

    function submit() {
        setConfirming(false);
        fetcher.submit({ id: inspectionId }, { method: "post", action: RESTORE_ROUTE });
    }

    return (
        <>
            <Button
                type="button"
                variant={variant}
                size="sm"
                className={className ?? ""}
                disabled={busy}
                onClick={() => setConfirming(true)}
            >
                {busy ? m.inspections_hub_restore_working() : m.inspections_hub_restore_action()}
            </Button>

            {/* Rendered next to the trigger rather than swallowed by a toast:
                the one refusal this can produce ("not cancelled") means the
                screen is stale, and the reader needs it beside the control they
                just pressed. */}
            {error && (
                <p className="mt-2 text-[12px] text-ih-bad-fg" role="alert">
                    {error}
                </p>
            )}

            <ConfirmDialog
                open={confirming}
                tone="default"
                title={m.inspections_hub_restore_confirm_title()}
                message={m.inspections_hub_restore_confirm_body()}
                confirmLabel={m.inspections_hub_restore_confirm_action()}
                cancelLabel={m.inspections_hub_restore_confirm_keep()}
                busy={busy}
                onCancel={() => setConfirming(false)}
                onConfirm={submit}
            />
        </>
    );
}
