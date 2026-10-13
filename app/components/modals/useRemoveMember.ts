import { useEffect, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import type { RemoveMemberTarget } from "./RemoveMemberDialog";

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
export function useRemoveMember() {
    const { submit, fetcher, busy } = useGuardedSubmit<{ ok?: boolean; error?: string }>();
    const [target, setTarget] = useState<RemoveMemberTarget | null>(null);
    /** True once the open dialog has sent a request, so an older result is never shown. */
    const [attempted, setAttempted] = useState(false);

    const settled = attempted && fetcher.state === "idle" ? fetcher.data : undefined;

    useEffect(() => {
        if (settled?.ok === true) {
            setTarget(null);
            setAttempted(false);
        }
    }, [settled]);

    const close = () => { setTarget(null); setAttempted(false); };

    return {
        open: (next: RemoveMemberTarget) => { setAttempted(false); setTarget(next); },
        dialogProps: {
            target,
            busy,
            error: settled?.ok === false ? (settled.error ?? null) : null,
            onConfirm: (t: RemoveMemberTarget) => {
                if (submit({ intent: "remove-member", id: t.id }, { method: "post" })) setAttempted(true);
            },
            onCancel: close,
        },
    };
}
