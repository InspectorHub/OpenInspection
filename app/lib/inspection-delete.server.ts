/**
 * The one server-side way to delete an inspection from the web app: the list's
 * batch Delete and the inspection page's Delete both call this, so both treat
 * the same answers the same way.
 *
 * An inspection that is already gone (404) counts as deleted: the person asked
 * for it to be gone and it is. Any other refusal is a failure that carries the
 * server's reason (for example a missing capability) or a readable fallback.
 */
import type { createApi } from "~/lib/api-client.server";
import { toActionResult } from "~/lib/inspector-portal-actions";
import { m } from "~/paraglide/messages";

type Api = ReturnType<typeof createApi>;

export interface DeleteInspectionResult {
  ok: boolean;
  intent: "delete";
  error: string | undefined;
}

export async function deleteInspectionViaApi(api: Api, id: string): Promise<DeleteInspectionResult> {
  try {
    const res = await api.inspections[":id"].$delete({ param: { id } });
    if ((res.status as number) === 404) return { ok: true, intent: "delete", error: undefined };
    return await toActionResult(res, "delete", m.inspections_hub_delete_error());
  } catch {
    return { ok: false, intent: "delete", error: m.inspections_hub_delete_error() };
  }
}

export interface DeleteInspectionsResult {
    /** True only when at least one id was given and every one of them is gone. */
    ok: boolean;
    intent: "delete-many";
    /** Ids that are gone (deleted now, or already gone). */
    deleted: string[];
    /** Ids that are still there, with the reason the server gave. */
    failed: Array<{ id: string; error: string }>;
}

/**
 * Delete several inspections in ONE request, one after another. There is no bulk
 * endpoint, and a second delete path on the same tables is not worth having; one
 * at a time keeps each cascade's audit rows in order. The outcome is per id so a
 * page can clear exactly what is gone and say what is not.
 */
export async function deleteInspectionsViaApi(api: Api, ids: readonly string[]): Promise<DeleteInspectionsResult> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of unique) {
        const res = await deleteInspectionViaApi(api, id);
        if (res.ok) deleted.push(id);
        else failed.push({ id, error: res.error ?? m.inspections_hub_delete_error() });
    }
    return { ok: unique.length > 0 && failed.length === 0, intent: "delete-many", deleted, failed };
}
