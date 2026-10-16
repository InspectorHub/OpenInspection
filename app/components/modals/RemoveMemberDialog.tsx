import { Banner, Select } from "@core/shared-ui";
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

/** The picker value for "leave their open inspections without an inspector". */
export const UNASSIGN = "__unassign__";

export function RemoveMemberDialog({
    target,
    busy,
    error,
    openInspections = null,
    candidates = [],
    choice = "",
    onChoice = () => {},
    onConfirm,
    onCancel,
}: {
    /** The member about to be removed, or null when closed. */
    target: RemoveMemberTarget | null;
    busy: boolean;
    /** The server's sentence for a refused removal, or null. */
    error: string | null;
    /** Set when the server refused because the member still has open inspections: the dialog then asks who takes them over. */
    openInspections?: number | null;
    candidates?: Array<{ value: string; label: string }>;
    choice?: string;
    onChoice?: (value: string) => void;
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
            confirmDisabled={openInspections !== null && choice === ""}
            onConfirm={() => { if (target) onConfirm(target); }}
            onCancel={onCancel}
        >
            <Banner tone="warn" className="mt-3 font-normal!">{m.settings_team_remove_member_warning()}</Banner>
            {target && openInspections !== null && (
                <div className="mt-3 space-y-2">
                    <Banner tone="warn" className="font-normal!">
                        {m.settings_team_remove_member_open_inspections({ name: target.name, count: openInspections })}
                    </Banner>
                    <Select
                        label={m.settings_team_remove_member_reassign_label()}
                        value={choice}
                        onChange={(e) => onChoice(e.target.value)}
                        options={[
                            { value: "", label: m.settings_team_remove_member_choose(), disabled: true },
                            ...candidates,
                            { value: UNASSIGN, label: m.settings_team_remove_member_unassign() },
                        ]}
                    />
                </div>
            )}
            {error && <Banner tone="danger" className="mt-3">{error}</Banner>}
        </ConfirmDialog>
    );
}
