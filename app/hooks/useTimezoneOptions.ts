import { useMemo, useSyncExternalStore } from "react";
import { TIMEZONE_SELECT_OPTIONS } from "~/lib/timezone-options";

const noopSubscribe = () => () => {};
const NONE: { value: string; label: string }[] = [];

/**
 * The zone options for a Settings picker, safe to hydrate.
 *
 * The full list, its order and every offset label come from the runtime's own time-zone data, and the
 * server's runtime and the visitor's browser do not agree on them (they differ in which zones exist and in
 * what offset some report). Rendering the table on both sides therefore hands hydration different text
 * (React error #418). The server and the hydrating render show only the stored zone, spelled from its own
 * name; the complete list follows once the browser has taken over.
 */
export function useTimezoneOptions(current: string | null | undefined): { value: string; label: string }[] {
    const full = useSyncExternalStore(noopSubscribe, () => TIMEZONE_SELECT_OPTIONS, () => NONE);
    return useMemo(
        () => (full.length > 0 || !current ? full : [{ value: current, label: current.replace(/_/g, " ") }]),
        [full, current],
    );
}
