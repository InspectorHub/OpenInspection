import { useEffect, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { UNASSIGN, type RemoveMemberTarget } from "./RemoveMemberDialog";

/**
 * State and submission for the Team page's "Remove member" dialog, kept out of
 * the route because that file is size-capped and because the dialog's
 * lifecycle is the interesting part.
 *
 * The dialog closes only when the removal SUCCEEDS. On a refusal it stays open
 * and carries the server's sentence, so "you cannot remove the last owner"
 * reaches the person who pressed the button instead of vanishing with the
 * dialog. Submission goes through `useGuardedSubmit`, whose ref-based guard is
 * what stops two confirms in one frame sending two requests.
 */
/** The team list as the page holds it; only active people who can be assigned inspections are offered. */
interface TeamEntry { id: string; name: string | null; email: string; role: string; status: string }

export function useRemoveMember(team: readonly TeamEntry[] = []) {
    const { submit, fetcher, busy } = useGuardedSubmit<{ ok?: boolean; error?: string; openInspections?: number }>();
    const [target, setTarget] = useState<RemoveMemberTarget | null>(null);
    /** "" = not chosen yet; UNASSIGN = leave them unassigned; otherwise the user id taking over. */
    const [choice, setChoice] = useState("");
    /** True once the open dialog has sent a request, so an older result is never shown. */
    const [attempted, setAttempted] = useState(false);

    const settled = attempted && fetcher.state === "idle" ? fetcher.data : undefined;

    useEffect(() => {
        if (settled?.ok === true) {
            setTarget(null);
            setAttempted(false);
        }
    }, [settled]);

    const close = () => { setTarget(null); setAttempted(false); setChoice(""); };
    const openInspections = settled?.ok === false ? (settled.openInspections ?? null) : null;
    const candidates = team
        .filter((t) => t.status !== "pending" && t.id !== target?.id && ["owner", "manager", "inspector"].includes(t.role))
        .map((t) => ({ value: t.id, label: t.name || t.email }));

    return {
        open: (next: RemoveMemberTarget) => { setAttempted(false); setChoice(""); setTarget(next); },
        dialogProps: {
            target,
            busy,
            // The count prompt replaces the server sentence: the dialog asks, rather than reports a failure.
            error: settled?.ok === false && openInspections === null ? (settled.error ?? null) : null,
            openInspections,
            candidates,
            choice,
            onChoice: setChoice,
            onConfirm: (t: RemoveMemberTarget) => {
                if (openInspections !== null && choice === "") return;
                const decision: Record<string, string> = choice === UNASSIGN ? { unassign: "true" } : choice ? { reassignTo: choice } : {};
                if (submit({ intent: "remove-member", id: t.id, ...decision }, { method: "post" })) setAttempted(true);
            },
            onCancel: close,
        },
    };
}
