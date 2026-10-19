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
import { toActionResult } from "~/lib/action-result";
import { m } from "~/paraglide/messages";
import { MAX_DELETE_BATCH } from "~/lib/inspection-delete-limit";

type Api = ReturnType<typeof createApi>;

export interface DeleteInspectionResult {
  ok: boolean;
  intent: "delete";
  error: string | undefined;
}

export async function deleteInspectionViaApi(api: Api, id: string): Promise<DeleteInspectionResult> {
  try {
    const res = await api.inspections[":id"].$delete({ param: { id } });
    // Any 404 counts as done, including a company member who has lost visibility of the inspection
    // (which also reads as 404): the outcome the person asked for, the row gone from their list, holds
    // either way, and reporting a failure would offer a retry that can never succeed.
    if ((res.status as number) === 404) return { ok: true, intent: "delete", error: undefined };
    // The delete route checks the caller's right to the id BEFORE it looks the id up, so for
    // someone who is not an owner a missing id answers 403, not 404. Only on a 403, ask the
    // read route: if the inspection no longer exists, the person's request is already met.
    if ((res.status as number) === 403 && (await isGone(api, id))) return { ok: true, intent: "delete", error: undefined };
    return await toActionResult(res, "delete", m.inspections_hub_delete_error());
  } catch {
    return { ok: false, intent: "delete", error: m.inspections_hub_delete_error() };
  }
}

async function isGone(api: Api, id: string): Promise<boolean> {
  try {
    // The typed read route is the whole inspection payload; only its status matters here.
    const read = api.inspections[":id"].$get as unknown as (args: { param: { id: string } }) => Promise<Response>;
    return (await read({ param: { id } })).status === 404;
  } catch {
    return false;
  }
}

export { MAX_DELETE_BATCH };

export interface DeleteInspectionsResult {
    /** True only when at least one id was given and every one of them is gone. */
    ok: boolean;
    intent: "delete-many";
    /** Ids that are gone (deleted now, or already gone). */
    deleted: string[];
    /** Ids that are still there, with the reason the server gave. */
    failed: Array<{ id: string; error: string }>;
    /** Set when the request was refused for naming more than MAX_DELETE_BATCH ids; nothing was deleted. */
    tooMany?: true;
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
    if (unique.length > MAX_DELETE_BATCH) {
        const error = m.inspections_list_delete_too_many({ max: MAX_DELETE_BATCH });
        return { ok: false, intent: "delete-many", deleted: [], failed: unique.map((id) => ({ id, error })), tooMany: true };
    }
    for (const id of unique) {
        const res = await deleteInspectionViaApi(api, id);
        if (res.ok) deleted.push(id);
        else failed.push({ id, error: res.error ?? m.inspections_hub_delete_error() });
    }
    return { ok: unique.length > 0 && failed.length === 0, intent: "delete-many", deleted, failed };
}
