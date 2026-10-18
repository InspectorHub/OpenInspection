/**
 * Settings -> Services: the two per-service reads (qualified inspectors and pay
 * rules) as one bulk request each.
 *
 * The page used to make one in-process call per service per kind (2S calls). The
 * API now answers for many services at once, so the cost is two calls however
 * many services there are; a request carries at most `MAX_IDS_PER_CALL` ids, so
 * only a company with more than that many services makes more (one per chunk).
 *
 * Both reads are best-effort; see readBulk for what a failure does.
 */
import type { createApi } from "~/lib/api-client.server";
import type { PayRule } from "~/components/settings/services/PayRuleWidget";
import { mapLimit } from "~/lib/concurrency";

type Api = ReturnType<typeof createApi>;

/**
 * Mirrors MAX_BULK_SERVICE_IDS on the server: each statement also binds the
 * tenant id, and D1 binds at most 100 parameters per statement.
 */
const MAX_IDS_PER_CALL = 90;

/** In-flight per-service reads when a bulk read has to be replaced by them. */
const FALLBACK_LANES = 4;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

type Res = { ok: boolean; status?: number; json: () => Promise<unknown> };

/**
 * One map from the bulk read. A chunk whose bulk read fails is NOT turned into
 * "none": that would show up as "Not set" / "all inspectors qualified", which is a
 * claim about the company. Its services are read one by one instead (the
 * per-service endpoints are unchanged); only if that read fails too does a
 * service fall back to an empty list, as it always did.
 */
async function readBulk<T>(
  ids: string[],
  bulk: (csv: string) => Promise<Res>,
  single: (id: string) => Promise<T[] | null>,
): Promise<Record<string, T[]>> {
  const out: Record<string, T[]> = Object.fromEntries(ids.map((id) => [id, [] as T[]]));
  await Promise.all(chunk(ids, MAX_IDS_PER_CALL).map(async (part) => {
    try {
      const res = await bulk(part.join(","));
      if (res.ok) {
        const body = (await res.json()) as { data?: Record<string, T[]> };
        for (const id of part) out[id] = body.data?.[id] ?? [];
        return;
      }
      // A refusal (no access, e.g. no company-finance capability) is an answer, not a
      // failure: the per-service routes would refuse too, so no extra calls.
      if ((res.status as number | undefined) === 403) return;
    } catch {
      // fall through to the per-service reads
    }
    await mapLimit(part, FALLBACK_LANES, async (id) => {
      try {
        out[id] = (await single(id)) ?? [];
      } catch {
        // stays empty, as before
      }
    });
  }));
  return out;
}

export async function loadServiceFanout(
  api: Api,
  serviceIds: string[],
): Promise<{ restrictionMap: Record<string, string[]>; payRuleMap: Record<string, PayRule[]> }> {
  if (serviceIds.length === 0) return { restrictionMap: {}, payRuleMap: {} };
  const [restrictionMap, payRuleMap] = await Promise.all([
    readBulk<string>(
      serviceIds,
      (ids) => api.services["inspectors-by-service"].$get({ query: { ids } }),
      async (id) => {
        const res = await api.services[":id"].inspectors.$get({ param: { id } });
        return res.ok ? (((await res.json()) as { data?: { userIds?: string[] } }).data?.userIds ?? []) : null;
      },
    ),
    readBulk<PayRule>(
      serviceIds,
      (ids) => api.services["pay-rules-by-service"].$get({ query: { ids } }),
      async (id) => {
        const res = await api.services[":id"]["pay-rules"].$get({ param: { id } });
        return res.ok ? (((await res.json()) as { data?: PayRule[] }).data ?? []) : null;
      },
    ),
  ]);
  return { restrictionMap, payRuleMap };
}
