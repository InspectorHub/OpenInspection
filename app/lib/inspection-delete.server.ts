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
