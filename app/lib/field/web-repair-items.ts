/**
 * The web host's `resources.repairItems`: the tenant's repair-item catalogue over the BFF resource route
 * `/resources/repair-items` (loader only). Never throws: any failed read answers no items.
 */
import type { FieldResources } from "@core/field-ui/data-source";
import type { RepairItemOption } from "@core/field-ui/data-source-types";

const REPAIR_ITEMS_ROUTE = "/resources/repair-items";

type RepairItems = NonNullable<FieldResources["repairItems"]>;

export function createWebRepairItems(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): RepairItems {
    return {
        async list(): Promise<RepairItemOption[]> {
            try {
                const res = await fetchImpl(REPAIR_ITEMS_ROUTE, { credentials: "include" });
                if (!res.ok) return [];
                const body = (await res.json()) as { items?: RepairItemOption[] };
                return Array.isArray(body.items) ? body.items : [];
            } catch {
                return [];
            }
        },
    };
}
