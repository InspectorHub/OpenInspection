import { Banner } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";

/**
 * The confirmation before removing a member from the team.
 *
 * ── WHY THE WARNING IS A BANNER, NOT SENTENCE FIVE OF THE BODY ──────────────
 * Removal is the one moment after which a member's phone or tablet can no
 * longer upload what they captured offline. Every other consequence is
 * recoverable; this one is not, and it only matters if it is read BEFORE the
 * confirm button is pressed. A warning-toned block says "stop and read this"
 * in a way a paragraph under the title does not.
 *
 * ── WHY A REFUSAL APPEARS HERE ──────────────────────────────────────────────
 * The server refuses some removals (the last owner, yourself). The dialog
 * stays open and says why, rather than closing as if it had worked.
 */
export interface RemoveMemberTarget {
    id: string;
    name: string;
}

export function RemoveMemberDialog({
    target,
    busy,
    error,
    onConfirm,
    onCancel,
}: {
    /** The member about to be removed, or null when closed. */
    target: RemoveMemberTarget | null;
    busy: boolean;
    /** The server's sentence for a refused removal, or null. */
    error: string | null;
    onConfirm: (target: RemoveMemberTarget) => void;
    onCancel: () => void;
}) {
    return (
        <ConfirmDialog
            open={target !== null}
            title={target ? m.settings_team_remove_member_title({ name: target.name }) : ""}
            message={m.settings_team_remove_member_consequence()}
            confirmLabel={m.settings_team_remove_member_confirm()}
            busy={busy}
            onConfirm={() => { if (target) onConfirm(target); }}
            onCancel={onCancel}
        >
            <Banner tone="warn" className="mt-3 font-normal!">{m.settings_team_remove_member_warning()}</Banner>
            {error && <Banner tone="danger" className="mt-3">{error}</Banner>}
        </ConfirmDialog>
    );
}
