import { Button, Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * What an administrator is told before a pack is taken out of service.
 *
 * ── WHY A COMPONENT AND NOT A CONFIRM ───────────────────────────────────────
 * `window.confirm` is forbidden here, and this is a good illustration of why:
 * the sentence a reader needs is different per kind. Un-installing a template
 * kind DELETES NOTHING — the local template is retired so it leaves the picker,
 * and inspections already using it carry their own snapshot — while
 * un-installing a comment pack really does remove the rows it added. One
 * sentence covering both would have to be vague about which, and vague is how
 * somebody clicks through a deletion believing it was a visibility change.
 *
 * ── AND IT SAYS THE REVERSIBLE PART OUT LOUD ────────────────────────────────
 * Installing again is a supported path, so the dialog says so. A reader who
 * cannot tell whether an action is final either treats a reversible one as
 * dangerous or an irreversible one as casual, and both are the same defect.
 */
export function UninstallConfirm({
    open,
    name,
    kind,
    submitting,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    /** The catalogue entry's name, so the title names what is being removed. */
    name: string;
    /** Decides which consequence is stated. Unknown kinds get the cautious one. */
    kind: string | null;
    submitting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal
            open={open}
            onClose={onCancel}
            title={m.marketplace_uninstall_confirm_title({ name })}
            size="md"
            footer={
                <>
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        {m.marketplace_uninstall_confirm_cancel()}
                    </Button>
                    <Button type="button" variant="danger" disabled={submitting} onClick={onConfirm}>
                        {submitting ? m.marketplace_uninstalling() : m.marketplace_uninstall_confirm_submit()}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <p className="text-[13px] text-ih-fg-2">
                    {kind === "comments"
                        ? m.marketplace_uninstall_confirm_comments()
                        : m.marketplace_uninstall_confirm_templates()}
                </p>
                <p className="text-[13px] text-ih-fg-3">{m.marketplace_uninstall_confirm_reversible()}</p>
            </div>
        </Modal>
    );
}
