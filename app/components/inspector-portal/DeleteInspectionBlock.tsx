import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Card, Button, Checkbox } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { CancelInspectionModal } from "./CancelInspectionModal";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { useOfflinePurgeOnDelete } from "~/hooks/useOfflinePurgeOnDelete";
import { useCapability } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * What the page already knows about the inspection, read to say what is about to
 * be lost. Nothing here is fetched for the dialog.
 */
export interface DeleteFacts {
    reportPublished: boolean;
    invoicePresent: boolean;
    /** The server's yes/no that money was collected (`lifecycle.moneyCollected`). */
    paymentReceived: boolean;
    agreementPresent: boolean;
    agreementSigned: boolean;
}

/**
 * Permanently deleting an inspection, from its own page.
 *
 * Its own block at the bottom of the page, not part of the lifecycle card:
 * cancelling and deleting are different things (cancelling keeps the record and
 * is the one that has a way back). Offered only to someone who holds the
 * deleteInspection capability, the same rule as the list, and the API enforces it.
 *
 * The confirmation says what is erased and cannot be confirmed until the person
 * ticks that they understand. Deleting runs through the same server path as the
 * list's Delete (`deleteInspectionViaApi`), and clears the device's cached copy
 * of the inspection the same way (`useOfflinePurgeOnDelete`). On success, or
 * when the inspection turns out to be gone already, it goes back to the list.
 */
export function DeleteInspectionBlock(props: { inspectionId: string; facts: DeleteFacts; canCancelInstead: boolean }) {
    // The hooks below run only for someone who may delete, so the gate is its own component.
    const canDelete = useCapability("deleteInspection");
    return canDelete ? <DeleteInspectionBlockInner {...props} /> : null;
}

function DeleteInspectionBlockInner({ inspectionId, facts, canCancelInstead }: { inspectionId: string; facts: DeleteFacts; canCancelInstead: boolean }) {
    const [open, setOpen] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const navigate = useNavigate();
    const { fetcher, submit, busy } = useGuardedSubmit<{ ok?: boolean; intent?: string; error?: string }>();
    const purgeOfflineData = useOfflinePurgeOnDelete(fetcher);

    const settled = fetcher.state === "idle" ? fetcher.data : undefined;
    const done = settled?.intent === "delete" && settled.ok === true;
    const error = settled?.intent === "delete" && settled.ok === false ? (settled.error ?? m.inspections_hub_delete_error()) : undefined;

    // After the purge hook (declared above), so the device is cleared as the page leaves.
    useEffect(() => {
        if (done) navigate("/inspections");
    }, [done, navigate]);

    const confirm = () => {
        const sent = submit({ intent: "delete" }, { method: "post" });
        if (sent) purgeOfflineData([inspectionId]);
    };

    const weighty = facts.reportPublished || facts.paymentReceived || facts.agreementSigned;

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_delete_block_title()} />
            <p className="text-[12px] text-ih-fg-3 mb-3">{m.inspections_hub_delete_block_hint()}</p>
            <Button type="button" variant="danger-link" size="sm" onClick={() => setOpen(true)}>
                {m.inspections_hub_delete_action()}
            </Button>
            {/* Mounted only while open, so closing discards the tick and any error. */}
            {open && (
                <DeleteDialog
                    facts={facts}
                    weighty={weighty}
                    busy={busy}
                    error={error}
                    onConfirm={confirm}
                    onClose={() => setOpen(false)}
                    onCancelInstead={canCancelInstead ? () => { setOpen(false); setCancelOpen(true); } : undefined}
                />
            )}
            {cancelOpen && <CancelInspectionModal open inspectionId={inspectionId} onClose={() => setCancelOpen(false)} />}
        </Card>
    );
}

function DeleteDialog({ facts, weighty, busy, error, onConfirm, onClose, onCancelInstead }: {
    facts: DeleteFacts;
    weighty: boolean;
    busy: boolean;
    error: string | undefined;
    onConfirm: () => void;
    onClose: () => void;
    onCancelInstead: (() => void) | undefined;
}) {
    const [consent, setConsent] = useState(false);
    const factLines: string[] = [];
    if (facts.reportPublished) factLines.push(m.inspections_hub_delete_fact_published());
    if (facts.invoicePresent) factLines.push(m.inspections_hub_delete_fact_invoice());
    if (facts.paymentReceived) factLines.push(m.inspections_hub_delete_fact_paid());
    if (facts.agreementSigned) factLines.push(m.inspections_hub_delete_fact_signed());

    return (
        <ConfirmDialog
            open
            title={m.inspections_hub_delete_title()}
            message={m.inspections_hub_delete_message()}
            confirmLabel={m.inspections_hub_delete_confirm()}
            confirmDisabled={!consent}
            busy={busy}
            onConfirm={onConfirm}
            onCancel={onClose}
        >
            <div className="mt-3 space-y-3 text-[13px] text-ih-fg-2">
                <div>
                    <p className="font-semibold text-ih-fg-1">{m.inspections_hub_delete_erases()}</p>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        <li>{m.inspections_hub_delete_item_results()}</li>
                        <li>{m.inspections_hub_delete_item_files()}</li>
                        <li>{m.inspections_hub_delete_item_reports()}</li>
                        <li>{m.inspections_hub_delete_item_invoice()}</li>
                        <li>{m.inspections_hub_delete_item_agreements()}</li>
                        <li>{m.inspections_hub_delete_item_messages()}</li>
                        <li>{m.inspections_hub_delete_item_links()}</li>
                    </ul>
                    {/* Stated only because the delete does not touch those entries (they are keyed by
                        the signing request, not by the inspection). Nothing is claimed about how long
                        they are kept. */}
                    {facts.agreementPresent && <p className="mt-1 text-ih-fg-3">{m.inspections_hub_delete_audit_note()}</p>}
                </div>
                {factLines.length > 0 && (
                    <div>
                        <p className="font-semibold text-ih-fg-1">{m.inspections_hub_delete_facts_title()}</p>
                        <ul className="list-disc pl-5 mt-1 space-y-0.5">
                            {factLines.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                    </div>
                )}
                {weighty && (
                    <div className="rounded-md border border-ih-border bg-ih-watch-bg px-3 py-2">
                        <p>{m.inspections_hub_delete_warning()}</p>
                        {onCancelInstead && (
                            <Button type="button" variant="danger-link" size="sm" onClick={onCancelInstead}>
                                {m.inspections_hub_delete_cancel_instead()}
                            </Button>
                        )}
                    </div>
                )}
                <Checkbox
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    label={m.inspections_hub_delete_consent()}
                />
                {error && <p role="alert" className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
            </div>
        </ConfirmDialog>
    );
}
