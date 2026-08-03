import { useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Releasing the order-wide report gate for this inspection.
 *
 * Deliberately NOT a `GateToggle`. That component's rule is "a switch, not a
 * button… nothing to confirm and nothing to lose by flipping it back", and it
 * owns ONE gate on the card for the artifact it gates. This owns BOTH gates for
 * the whole order, it hands a client a report the tenant's own rules said to
 * hold, and it demands a reason. All three of those fail the switch test.
 *
 * The weight is on the STATE, not the action. Unlocked, this reads as a standing
 * record — who released it, when, and why — because requiring a reason is
 * pointless if nobody ever reads it back. Locked, it is a quiet piece of text
 * that does not compete with the card's real actions; nobody comes to this
 * screen looking to override anything.
 */
export function ReportGateUnlock({
    unlockedAt,
    unlockedByName,
    unlockReason,
    formatDate,
}: {
    unlockedAt: string | null;
    unlockedByName: string | null;
    unlockReason: string | null;
    /** Hub-supplied formatter so the date reads in the tenant's timezone. */
    formatDate: (iso: string) => string;
}) {
    const fetcher = useFetcher();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const busy = fetcher.state !== "idle";

    function submit() {
        fetcher.submit(
            { intent: "unlock-report", reason: reason.trim() },
            { method: "post" },
        );
        setOpen(false);
        setReason("");
    }

    if (unlockedAt) {
        return (
            <div className="mt-4 pt-3 border-t border-ih-border">
                <p className="text-[12px] font-bold text-ih-watch-fg">
                    {m.hub_gate_unlocked_heading()}
                </p>
                <p className="text-[12px] text-ih-fg-3 mt-0.5">
                    {m.hub_gate_unlocked_by({
                        name: unlockedByName ?? m.hub_gate_unlocked_unknown_person(),
                        date: formatDate(unlockedAt),
                    })}
                </p>
                {/* The reason is the whole point of asking for one. It is quoted
                    rather than paraphrased so it reads as somebody's words. */}
                {unlockReason && (
                    <p className="text-[12px] text-ih-fg-2 mt-1 italic">“{unlockReason}”</p>
                )}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => fetcher.submit({ intent: "relock-report" }, { method: "post" })}
                    className="mt-2 text-[12px] font-bold text-ih-primary hover:underline disabled:opacity-50"
                >
                    {m.hub_gate_relock_action()}
                </button>
            </div>
        );
    }

    return (
        <div className="mt-4 pt-3 border-t border-ih-border">
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-[12px] font-bold text-ih-fg-3 hover:text-ih-fg-1 hover:underline"
            >
                {m.hub_gate_unlock_action()}
            </button>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title={m.hub_gate_unlock_title()}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setOpen(false)}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            variant="danger"
                            // A reason is the point of the dialog, so an empty one
                            // cannot submit. Disabled rather than validated after
                            // the fact — there is nothing to explain, the field
                            // says what it wants.
                            disabled={!reason.trim() || busy}
                            onClick={submit}
                        >
                            {m.hub_gate_unlock_confirm()}
                        </Button>
                    </>
                }
            >
                <p className="text-[13px] text-ih-fg-2">{m.hub_gate_unlock_body()}</p>
                <label className="block mt-3">
                    <span className="block text-[11px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
                        {m.hub_gate_unlock_reason_label()}
                    </span>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                        maxLength={500}
                        placeholder={m.hub_gate_unlock_reason_placeholder()}
                        aria-label={m.hub_gate_unlock_reason_label()}
                        className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                    />
                </label>
            </Modal>
        </div>
    );
}
