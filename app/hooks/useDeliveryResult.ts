import { useRef, useState } from "react";
import type { DeliveryOutcome } from "~/lib/inspector-portal-actions";

/**
 * The outcome of a send, once it has settled while the dialog was open and until the person goes back.
 *
 * The fetcher belongs to the page and outlives the dialog, so a result already on it when the dialog
 * opens is an older send's and is never shown (see useFetcherResult for the same rule on closing).
 */
export function useDeliveryResult(
    fetcher: { state: string; data: unknown },
    intent: string,
): { delivery: DeliveryOutcome | null; back: () => void } {
    const atMount = useRef(fetcher.data);
    const [backed, setBacked] = useState<unknown>(null);
    const data = fetcher.data as { intent?: string; delivery?: DeliveryOutcome } | undefined;
    const show = fetcher.state === "idle" && data !== undefined && data !== atMount.current && data !== backed
        && data.intent === intent && data.delivery !== undefined;
    return { delivery: show ? data.delivery ?? null : null, back: () => setBacked(fetcher.data) };
}
