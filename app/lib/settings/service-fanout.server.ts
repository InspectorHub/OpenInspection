/**
 * Settings -> Services: the two per-service reads (qualified inspectors and pay
 * rules) as one bulk request each.
 *
 * The page used to make one in-process call per service per kind (2S calls). The
 * API now answers for many services at once, so the cost is two calls however
 * many services there are; a request carries at most `MAX_IDS_PER_CALL` ids, so
 * only a company with more than that many services makes more (one per chunk).
 *
 * Both reads are best-effort: a failure leaves that map as empty lists for
 * every service, which is what the page showed when a per-service read failed.
 */
import type { createApi } from "~/lib/api-client.server";
import type { PayRule } from "~/components/settings/services/PayRuleWidget";

type Api = ReturnType<typeof createApi>;

/** Mirrors MAX_BULK_SERVICE_IDS on the server. */
export const MAX_IDS_PER_CALL = 100;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function readBulk<T>(
  ids: string[],
  call: (csv: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
): Promise<Record<string, T[]>> {
  const out: Record<string, T[]> = Object.fromEntries(ids.map((id) => [id, [] as T[]]));
  await Promise.all(chunk(ids, MAX_IDS_PER_CALL).map(async (part) => {
    try {
      const res = await call(part.join(","));
      if (!res.ok) return;
      const body = (await res.json()) as { data?: Record<string, T[]> };
      for (const id of part) out[id] = body.data?.[id] ?? [];
    } catch {
      // A failing read must not take down the services page.
    }
  }));
  return out;
}

export async function loadServiceFanout(
  api: Api,
  serviceIds: string[],
): Promise<{ restrictionMap: Record<string, string[]>; payRuleMap: Record<string, PayRule[]> }> {
  if (serviceIds.length === 0) return { restrictionMap: {}, payRuleMap: {} };
  const [restrictionMap, payRuleMap] = await Promise.all([
    readBulk<string>(serviceIds, (ids) => api.services["inspectors-by-service"].$get({ query: { ids } })),
    readBulk<PayRule>(serviceIds, (ids) => api.services["pay-rules-by-service"].$get({ query: { ids } })),
  ]);
  return { restrictionMap, payRuleMap };
}
