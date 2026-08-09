import { INSPECTION_FILTERS, type FilterId, type Tag } from "~/lib/dashboard-schema";
import { m } from "~/paraglide/messages";

/**
 * The time-range strip and the tag select, under the workflow tabs.
 *
 * Split out of the route so the list page keeps to its job of holding state:
 * these are two presentational controls with no logic of their own, and the
 * route was carrying their markup inline. Behaviour is unchanged.
 */
export function InspectionsFilterStrip({
    activeFilter,
    setActiveFilter,
    filterCounts,
    tags,
    activeTagFilter,
    setActiveTagFilter,
}: {
    activeFilter: FilterId;
    setActiveFilter: (id: FilterId) => void;
    filterCounts: Partial<Record<FilterId, number>>;
    tags: Tag[];
    activeTagFilter: string;
    setActiveTagFilter: (id: string) => void;
}) {
    return (
        <div className="flex items-center gap-0 flex-wrap border-b border-ih-border">
            {INSPECTION_FILTERS.map((f) => (
                <button
                    key={f.id}
                    onClick={() => setActiveFilter(f.id)}
                    className={`px-3 py-2 border-b-2 text-[11px] font-bold transition-colors ${
                        activeFilter === f.id
                            ? "border-ih-primary text-ih-primary"
                            : "border-transparent text-ih-fg-3 hover:text-ih-fg-1"
                    }`}
                >
                    {f.label}
                    <span className="ml-1 opacity-70">{filterCounts[f.id] ?? 0}</span>
                </button>
            ))}
            {tags.length > 0 && (
                <select
                    value={activeTagFilter}
                    onChange={(e) => setActiveTagFilter(e.target.value)}
                    className="h-7 px-2 rounded-md text-[11px] font-bold bg-ih-bg-muted text-ih-fg-2 border-0 outline-none ml-2"
                >
                    <option value="">{m.inspections_list_filter_all_tags()}</option>
                    {tags.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
            )}
        </div>
    );
}
