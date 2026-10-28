/**
 * The web host's `resources.itemTags`: the tags on each checklist item over the BFF resource route
 * `/resources/inspection-item-tags` (loader = GET the inspection's item -> tags map, action = add or remove one).
 *
 * It never throws. A failed, redirected or unreadable read answers `null` (the editor then shows what it has);
 * a failed write answers `{ ok: false }` and the editor takes the change back.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { ItemTagMap } from "@core/field-ui/data-source-types";

export const ITEM_TAGS_ROUTE = "/resources/inspection-item-tags";

type ItemTags = NonNullable<FieldResources["itemTags"]>;

function writeForm(intent: "add" | "remove", inspectionId: string, itemId: string, tagId: string): FormData {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("inspectionId", inspectionId);
    fd.set("itemId", itemId);
    fd.set("tagId", tagId);
    return fd;
}

export function createWebItemTags(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): ItemTags {
    async function write(intent: "add" | "remove", inspectionId: string, itemId: string, tagId: string): Promise<CommandResult> {
        try {
            // busy-controls-allow: the caller (useItemTags) sends one request per item and tag at a time, and the API treats attaching an attached tag and detaching a detached one as no-ops
            const res = await fetchImpl(ITEM_TAGS_ROUTE, {
                method: "POST",
                credentials: "include",
                headers: { accept: "application/json" },
                body: writeForm(intent, inspectionId, itemId, tagId),
            });
            if (!res.ok || res.redirected) return { ok: false };
            if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return { ok: false };
            const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
            return body !== null && typeof body === "object" && body.success === true ? { ok: true } : { ok: false };
        } catch {
            return { ok: false };
        }
    }

    return {
        async list(inspectionId: string): Promise<ItemTagMap | null> {
            try {
                const res = await fetchImpl(`${ITEM_TAGS_ROUTE}?inspectionId=${encodeURIComponent(inspectionId)}`, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                });
                if (!res.ok || res.redirected) return null;
                if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return null;
                const body = (await res.json().catch(() => null)) as { tags?: unknown } | null;
                const tags = body?.tags;
                return tags !== null && typeof tags === "object" && !Array.isArray(tags) ? (tags as ItemTagMap) : null;
            } catch {
                return null;
            }
        },
        add: (inspectionId, itemId, tagId) => write("add", inspectionId, itemId, tagId),
        remove: (inspectionId, itemId, tagId) => write("remove", inspectionId, itemId, tagId),
    };
}
