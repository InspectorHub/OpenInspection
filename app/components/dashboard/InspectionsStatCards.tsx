import { Card, Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The four counts above the inspection list. Presentation only — split out of
 * the route with the rest of its inline markup so the page file holds state and
 * data flow rather than layout.
 */
export function InspectionsStatCards({
    counts,
}: {
    counts: { upcoming: number; inProgress: number; needsAttention: number; recent: number };
}) {
    const stats = [
        { label: m.inspections_list_stat_upcoming(), value: counts.upcoming, icon: "calendar" as const, color: "text-ih-primary-text bg-ih-primary-tint" },
        { label: m.inspections_list_stat_in_progress(), value: counts.inProgress, icon: "edit" as const, color: "text-ih-watch-fg bg-ih-watch-bg" },
        { label: m.inspections_list_stat_needs_attention(), value: counts.needsAttention, icon: "zap" as const, color: "text-ih-bad-fg bg-ih-bad-bg" },
        { label: m.inspections_list_stat_recent_reports(), value: counts.recent, icon: "check" as const, color: "text-ih-ok-fg bg-ih-ok-bg" },
    ];

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.map((stat) => (
                <Card key={stat.label} className="p-ih-card cursor-pointer hover:shadow-ih-popover transition-all">
                    <div className={`w-10 h-10 rounded-md flex items-center justify-center mb-3 ${stat.color}`}>
                        <Icon name={stat.icon} size={20} />
                    </div>
                    <div className="text-xl font-bold text-ih-fg-1 tabular-nums">{stat.value}</div>
                    <div className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-[0.15em]">{stat.label}</div>
                </Card>
            ))}
        </div>
    );
}
