import { relayedApiError } from "~/lib/relayed-api-error";
import type { createApi } from "~/lib/api-client.server";

/**
 * The company default for whether an inspector invited from now on can see every inspection. A failed
 * read answers true, which is what every company has until someone changes it: the page then shows the
 * default as "on" rather than claiming a restriction it could not confirm.
 */
export async function loadNewInspectorDefault(api: ReturnType<typeof createApi>): Promise<boolean> {
  try {
    const res = await api.team.defaults.$get();
    if (!res.ok) return true;
    const body = (await res.json()) as unknown as { data?: { newInspectorsViewAll?: boolean } };
    return body.data?.newInspectorsViewAll !== false;
  } catch {
    return true;
  }
}

/** The Team page's "set-new-inspector-default" action. */
export async function setNewInspectorDefault(api: ReturnType<typeof createApi>, form: FormData) {
  const res = await api.team.defaults.$put({ json: { newInspectorsViewAll: form.get("viewAll") === "true" } });
  return res.ok ? { ok: true as const } : { ok: false as const, error: await relayedApiError(res) };
}
