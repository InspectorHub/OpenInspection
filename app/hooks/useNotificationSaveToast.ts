import { useEffect, useRef } from "react";
import { pushToast } from "~/hooks/useToast";
import { m } from "~/paraglide/messages";

/**
 * Announce the result of a preference write, once per completed write.
 *
 * Three surfaces run the same fetcher against three different routes, and each
 * would otherwise grow its own copy of "did that land". They already disagreed
 * once about something smaller (which shape counts as an error), which is
 * exactly how one of them ends up silently swallowing a failure.
 *
 * FAILURE IS A TOAST, and that is the part that matters. The inline red line it
 * replaces sat inside a card the reader may well have scrolled past — a message
 * about mail they will not receive, placed where they cannot see it. Success is
 * a toast too, for consistency with the rest of the app; the in-flight state
 * stays inline next to the control, because "saving" is about the thing you
 * just touched and a toast would be pointing at the wrong place.
 */
export function useNotificationSaveToast({
    data, failed, error,
}: {
    /** The fetcher payload. A new object identity means a write completed. */
    data: unknown;
    failed: boolean;
    error?: string | null;
}) {
    // Keyed on identity, not on a boolean: two failures in a row are two
    // events, and a flag would announce only the first.
    const seen = useRef<unknown>(null);
    useEffect(() => {
        if (!data || data === seen.current) return;
        seen.current = data;
        // A failure gets longer on screen than a confirmation: "Saved" is a
        // glance, but a failure asks the reader to decide whether to try again.
        // `String(...)` unifies paraglide's branded LocalizedString with the
        // plain string the queue takes.
        pushToast(failed
            ? { message: String(error ?? m.notif_prefs_save_failed()), variant: "error", durationMs: 6000 }
            : { message: String(m.notif_prefs_saved()), variant: "success", durationMs: 2500 });
    }, [data, failed, error]);
}
