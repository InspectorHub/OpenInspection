import { Link } from "react-router";
import { m } from "~/paraglide/messages";
import type { StatFocus } from "~/lib/dashboard-filters";

/** The four stat-card labels, reused so this bar and the card it came from
 *  cannot drift apart — and so this needs no new message key. */
const FOCUS_LABELS: Record<StatFocus, () => string> = {
    upcoming: m.inspections_list_stat_upcoming,
    in_progress: m.inspections_list_stat_in_progress,
    needs_attention: m.inspections_list_stat_needs_attention,
    recent: m.inspections_list_stat_recent_reports,
};

/**
 * #90 — when a stat card has narrowed the list, SAY SO.
 *
 * Found in the browser rather than by a spec: with `?focus=` active the tab
 * strip still highlighted "All 8" above a three-row list, so the screen carried
 * two numbers that contradicted each other and nothing said the list had been
 * narrowed. The card was the only way in and browser Back the only way out.
 *
 * Renders nothing when there is no focus, so the caller needs no conditional.
 */
export function InspectionsFocusBar({ focus }: { focus: StatFocus | null }) {
    if (!focus) return null;
    return (
        <div className="flex items-center gap-2 text-[13px]">
            {/* Measured in the browser rather than chosen from the palette.
                `Pill tone="primary"` is `bg-ih-primary-tint text-ih-primary-text`
                and comes out at 3.83:1 at 11px; the bare `text-ih-primary-text`
                link was 4.33. Both are under the 4.5 floor for small text, and
                both were WORSE than the controls beside them (Dismiss 4.76, tab
                strip 4.55) — so this was a deficit introduced here, not the
                design system's baseline. `text-ih-fg-2` measures 7.24 on this
                background. `lint:contrast` reads the stylesheet and stays green
                on all of it. */}
            <span className="rounded-full bg-ih-bg-muted px-2 py-0.5 text-[12px] font-bold text-ih-fg-2">
                {FOCUS_LABELS[focus]()}
            </span>
            <Link
                to="/inspections"
                className="text-ih-fg-2 underline underline-offset-2 hover:no-underline"
            >
                {m.inspections_list_nomatch_clear()}
            </Link>
        </div>
    );
}
