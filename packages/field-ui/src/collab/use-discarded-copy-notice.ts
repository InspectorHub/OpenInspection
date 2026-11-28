import { useState } from "react";
import type { DiscardedCopyNotice, ResultsDocHandle } from "./results-doc-connection";

/**
 * #478 — the editor's view of the connection's latest discard.
 *
 * The connection names the loss on `handle.discarded`; the notice shows while
 * it holds findings and has not been dismissed. A NEW discard (a different
 * `atMs`) shows again — dismissing one loss must never hide the next. A
 * discard that held no findings never shows: nothing was lost, so there is
 * nothing to interrupt for.
 */
export function useDiscardedCopyNotice(collab: ResultsDocHandle | null): {
    notice: DiscardedCopyNotice | null;
    dismiss: () => void;
} {
    const discarded = collab?.discarded ?? null;
    const [dismissedAtMs, setDismissedAtMs] = useState<number | null>(null);
    const show = discarded !== null && discarded.itemCount > 0 && discarded.atMs !== dismissedAtMs;
    return {
        notice: show ? discarded : null,
        dismiss: () => setDismissedAtMs(discarded?.atMs ?? null),
    };
}
