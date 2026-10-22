/**
 * The web host's `resources.costItems`. Only `list` is wired: it GETs the cost-items resource route
 * `/resources/cost-items?inspectionId=` and answers the lines. `save` belongs to the cost drawer, which
 * still runs its own requests; it answers a plain "not wired" failure rather than doing nothing silently.
 *
 * Nothing here throws: a failed, unauthenticated, redirected or malformed read answers no lines, which is
 * what the route itself answers when it cannot read them.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { CostItemView, CostItemsListing } from "@core/field-ui/data-source-types";

export const COST_ITEMS_ROUTE = "/resources/cost-items";

type CostItems = NonNullable<FieldResources["costItems"]>;

const NOT_WIRED = "Saving cost lines is not wired to the web data source yet; the cost drawer still uses its own path for it.";

const EMPTY: CostItemsListing = { items: [] };

export function createWebCostItems(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): CostItems {
    return {
        async list(inspectionId: string): Promise<CostItemsListing> {
            try {
                const res = await fetchImpl(`${COST_ITEMS_ROUTE}?inspectionId=${encodeURIComponent(inspectionId)}`, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                });
                if (!res.ok || res.redirected) return EMPTY;
                if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return EMPTY;
                const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
                return Array.isArray(body?.items) ? { items: body.items as CostItemView[] } : EMPTY;
            } catch {
                return EMPTY;
            }
        },
        save: async (): Promise<CommandResult> => ({ ok: false, error: NOT_WIRED }),
    };
}
