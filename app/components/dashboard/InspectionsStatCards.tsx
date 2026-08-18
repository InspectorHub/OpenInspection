import { Link } from "react-router";
import { Card } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** The four counts, keyed so a caller can name the one it is targeting. */
export type StatKey = "upcoming" | "inProgress" | "needsAttention" | "recent";

/**
 * Where each card goes on the dashboard. `?focus=` and not `?workflow=`: see
 * `statFocusIds` for why none of the four is a workflow tab.
 */
export const STAT_TARGETS: Record<StatKey, string> = {
    upcoming: "/inspections?focus=upcoming",
    inProgress: "/inspections?focus=in_progress",
    needsAttention: "/inspections?focus=needs_attention",
    recent: "/inspections?focus=recent",
};

/**
 * The four counts above the inspection list. Presentation only — split out of
 * the route with the rest of its inline markup so the page file holds state and
 * data flow rather than layout.
 *
 * Each card is a LINK when the caller gives it a target, and inert when it does
 * not. The cards used to carry `cursor-pointer`, a hover lift and a transition
 * with no destination of any kind, which is an affordance the component could
 * not honour: you aim at the number, click, and the page does nothing. The
 * pointer cursor now rides on the target rather than on the layout, so a stat
 * with nowhere to go simply reads as a number.
 *
 * The link is a real `<a href>` — `Card` from shared-ui is a hard-coded `<div>`
 * with no `as`/`href`/`to`, so the anchor wraps it rather than replacing it.
 * That keeps middle-click and "open in new tab" working, which is the point:
 * "Needs Attention: 3" is exactly the number you want to open beside the list
 * you are already reading.
 */
export function InspectionsStatCards({
    counts,
    targets = {},
}: {
    counts: { upcoming: number; inProgress: number; needsAttention: number; recent: number };
    /**
     * Where each card navigates. Omitted keys render inert — no link, and no
     * `cursor-pointer` either, since a pointer cursor over a dead card is a
     * promise nothing keeps.
     */
    targets?: Partial<Record<StatKey, string>>;
}) {
    const stats = [
        { key: "upcoming" as const, label: m.inspections_list_stat_upcoming(), value: counts.upcoming, rule: "bg-ih-primary" },
        { key: "inProgress" as const, label: m.inspections_list_stat_in_progress(), value: counts.inProgress, rule: "bg-ih-watch-fg" },
        { key: "needsAttention" as const, label: m.inspections_list_stat_needs_attention(), value: counts.needsAttention, rule: "bg-ih-bad" },
        { key: "recent" as const, label: m.inspections_list_stat_recent_reports(), value: counts.recent, rule: "bg-ih-ok-fg" },
    ];

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.map((stat) => {
                const body = (
                    <div className="flex items-center gap-3">
                        {/* A 3px severity rule where a 32px icon used to be.
                            The four glyphs carried almost nothing — the label
                            already says which count this is — but the COLOUR
                            does real work: primary / watch / bad / ok is how an
                            inspector separates "scheduled" from "gone wrong".
                            Measured why it had to go: with the icon in place,
                            three of the four labels wrapped to two lines at
                            1400px, so the row of cards had ragged text blocks.
                            The rule keeps the encoding and returns 44px of
                            width to the words. */}
                        <div className={`w-[3px] self-stretch shrink-0 rounded-full ${stat.rule}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1 text-[12px] font-bold text-ih-fg-3 uppercase tracking-[0.12em]">
                            {stat.label}
                        </div>
                        {/* A zero is quieter than a non-zero, deliberately.
                            "0 In Progress" is not a call to action and "3 Needs
                            Attention" is; rendering them at the same weight makes
                            the reader do the filtering the card exists to do.
                            `tabular-nums` keeps 1, 3 and 11 the same width so the
                            four cards' digits line up as a column of quantities
                            rather than drifting with the glyphs. */}
                        <div
                            className={`shrink-0 text-[34px] leading-none font-bold tabular-nums ${
                                stat.value === 0 ? "text-ih-fg-3" : "text-ih-fg-1"
                            }`}
                        >
                            {stat.value}
                        </div>
                    </div>
                );
                const to = targets[stat.key];
                if (!to) {
                    return <Card key={stat.key} className="p-ih-card h-full">{body}</Card>;
                }
                return (
                    <Link
                        key={stat.key}
                        to={to}
                        className="block rounded-ih-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ih-primary"
                    >
                        <Card className="p-ih-card h-full cursor-pointer hover:shadow-ih-popover transition-all">
                            {body}
                        </Card>
                    </Link>
                );
            })}
        </div>
    );
}
