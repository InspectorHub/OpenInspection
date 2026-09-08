import { useCallback, useMemo } from "react";

import { useIsMobile } from "~/hooks/useBreakpoint";
import { MOBILE_HIDDEN_COLUMNS } from "../../server/lib/dashboard-columns";

/**
 * Which of the columns a user has switched on actually render at this width.
 *
 * `DashboardColumn.mobileVisible` has said since it was written that a column
 * marked `false` is "dropped on small viewports even when toggled on". Five
 * columns carry it and nothing consulted it, so what a narrow viewport actually
 * did was whatever the CSS happened to do — which is not the same statement,
 * and was not checked against this one.
 *
 * The set comes from the registry that declares it rather than being restated
 * here; see `MOBILE_HIDDEN_COLUMNS` for why the flag is not copied into the
 * renderer's own column list.
 *
 * Order is the caller's, untouched: the visual sequence is decided by the list
 * handed in, and a filter that reordered would move columns for reasons the
 * user did not ask for.
 */
export function visibleColumnIds(enabled: readonly string[], narrow: boolean): string[] {
    if (!narrow) return [...enabled];
    return enabled.filter((id) => !MOBILE_HIDDEN_COLUMNS.has(id));
}

/**
 * The predicate the ROWS render by — which is not the one the Customize
 * Columns popover offers.
 *
 * ⚠️ THE POPOVER MUST KEEP THE UNNARROWED LIST. Narrowing it too would hide
 * the switch for exactly the columns a phone drops, and the person holding the
 * phone is the one who needs them back for the desktop they open next. Keeping
 * that distinction here, beside the rule it depends on, is why this is a hook
 * rather than three lines in the route: the route is where the two predicates
 * would drift into one.
 */
export function useColumnPredicates(enabled: readonly string[]): {
    /** What the Customize Columns popover offers — the user's own choice, at any width. */
    isColumnVisible: (id: string) => boolean;
    /** What the rows draw — the same list, minus what a narrow viewport drops. */
    isColumnRendered: (id: string) => boolean;
} {
    const narrow = useIsMobile();
    const chosen = useMemo(() => new Set(enabled), [enabled]);
    const rendered = useMemo(
        () => new Set(visibleColumnIds(enabled, narrow)),
        [enabled, narrow],
    );
    return {
        isColumnVisible: useCallback((id: string) => chosen.has(id), [chosen]),
        isColumnRendered: useCallback((id: string) => rendered.has(id), [rendered]),
    };
}
