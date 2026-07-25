import { EmptyState, Button, Icon } from "@core/shared-ui";
import { activeListFilters, emptyListReason, type ListFilterState } from "~/lib/dashboard-filters";
import { m } from "~/paraglide/messages";

/**
 * What to show when the inspection list renders nothing.
 *
 * There are two situations and they need opposite remedies: a workspace with no
 * inspections wants a way to create the first one, and a list emptied by filters
 * wants those filters gone. One message served both — "No inspections yet. Click
 * + New Inspection above to get started." — so a workspace with two hundred
 * inspections was told it had none the moment a tab, a tag or a search excluded
 * them all. It also pointed at a control that does not exist under that name (the
 * button reads "New Inspection"), when an empty state is the natural place to
 * CONTAIN the action rather than describe where to find it.
 */
export function InspectionsEmptyState({
    totalAll,
    filters,
    onClearFilters,
    onCreate,
}: {
    /** Rows the loader returned, before filtering — how we tell the two cases apart. */
    totalAll: number;
    filters: ListFilterState;
    onClearFilters: () => void;
    onCreate: () => void;
}) {
    const count = activeListFilters(filters).length;

    if (emptyListReason(totalAll, filters) === "no-matches") {
        return (
            <EmptyState
                icon={<Icon name="search" size={32} />}
                title={m.inspections_list_nomatch_title()}
                description={
                    count === 1
                        ? m.inspections_list_nomatch_desc_one()
                        : m.inspections_list_nomatch_desc_many({ count })
                }
                action={
                    <Button variant="secondary" size="sm" onClick={onClearFilters}>
                        {m.inspections_list_nomatch_clear()}
                    </Button>
                }
            />
        );
    }

    return (
        <EmptyState
            icon={<Icon name="check" size={32} />}
            title={m.inspections_list_empty_title()}
            description={m.inspections_list_empty_desc()}
            action={
                <Button variant="primary" size="sm" icon={<Icon name="plus" size={14} />} onClick={onCreate}>
                    {m.inspections_list_action_new()}
                </Button>
            }
        />
    );
}
