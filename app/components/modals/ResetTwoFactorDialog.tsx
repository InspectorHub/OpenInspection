import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";

/**
 * The owner's confirmation before clearing another member's second factor.
 *
 * ── WHY IT ASKS AT ALL ──────────────────────────────────────────────────────
 * This is the only action in the product that lowers ANOTHER person's
 * authentication requirement, and it leaves no visible trace: the member's row
 * afterwards is indistinguishable from one that never enrolled. An audit row
 * records it, but nobody reads an audit log to find out what they just did.
 *
 * ── WHY THE MEMBER IS NAMED IN THE BODY ─────────────────────────────────────
 * An owner reaching for this usually has two people in front of them — the one
 * who called about being locked out, and the row above it. "This member" is not
 * enough to tell those apart at the moment of pressing.
 *
 * ── WHY THE TWO LIMITS ARE STATED ───────────────────────────────────────────
 * The reset does not change the password and does not end the member's
 * sessions, and an owner who believes an account is COMPROMISED needs to know
 * that before they use this instead of removing the member. Saying so is
 * cheaper than the support conversation that follows not saying it.
 */
export interface ResetTwoFactorTarget {
    id: string;
    email: string;
}

export function ResetTwoFactorDialog({
    target,
    busy,
    onConfirm,
    onCancel,
}: {
    /** The member whose enrolment is about to be cleared, or null when closed. */
    target: ResetTwoFactorTarget | null;
    busy: boolean;
    onConfirm: (target: ResetTwoFactorTarget) => void;
    onCancel: () => void;
}) {
    return (
        <ConfirmDialog
            open={target !== null}
            title={m.settings_team_reset_two_factor_title()}
            message={target ? m.settings_team_reset_two_factor_confirm({ email: target.email }) : ""}
            confirmLabel={m.settings_team_reset_two_factor()}
            busy={busy}
            onConfirm={() => { if (target) onConfirm(target); }}
            onCancel={onCancel}
        />
    );
}
