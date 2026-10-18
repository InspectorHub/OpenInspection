/**
 * Settings -> Profile: saving a new credential order.
 *
 * Every credential gets its own PATCH (`sortOrder` = its new position), and the
 * writes are independent. They run at most four at a time, and EVERY one is
 * attempted even if another fails: stopping at the first failure would leave
 * the list half re-ordered, which is worse than a failed save. The outcome is
 * `failed: null` when all succeeded; the first non-ok response (so its message
 * can be shown) when the API refused one; or "threw" when a request could not be
 * made at all.
 */
import type { createApi } from "~/lib/api-client.server";
import { mapLimit } from "~/lib/concurrency";

type Api = ReturnType<typeof createApi>;
type Patched = { ok: boolean; json: () => Promise<unknown> };

export async function reorderCredentials(api: Api, ids: string[]): Promise<{ failed: Patched | "threw" | null }> {
  const results = await mapLimit(ids, 4, async (id, i): Promise<Patched | "threw"> => {
    try {
      return await api.credentials[":id"].$patch({ param: { id }, json: { sortOrder: i } });
    } catch {
      return "threw";
    }
  });
  const failed = results.find((r) => r === "threw" || !r.ok);
  return { failed: failed ?? null };
}
