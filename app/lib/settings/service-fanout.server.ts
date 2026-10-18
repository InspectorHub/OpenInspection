/**
 * Settings → Services: the two per-service reads (qualified inspectors and pay
 * rules), run as one bounded wave.
 *
 * Each service costs one in-process call per kind, so S services cost 2S calls.
 * They used to run as two separate unbounded fan-outs awaited one after the
 * other; now both run at the same time, each limited to `LANES` calls in flight.
 * The call count is still linear in S: making it constant needs a bulk endpoint
 * (`WHERE service_id IN (...)`), which this does not add.
 */
import type { createApi } from "~/lib/api-client.server";
import type { PayRule } from "~/components/settings/services/PayRuleWidget";
import { mapLimit } from "~/lib/concurrency";
import { loadPayRuleMap } from "./pay-rules.server";

type Api = ReturnType<typeof createApi>;

/** In-flight calls per fan-out. Two fan-outs run together, so at most twice this. */
export const FANOUT_LANES = 4;

async function loadRestrictionMap(api: Api, serviceIds: string[]): Promise<Record<string, string[]>> {
  const rows = await mapLimit(serviceIds, FANOUT_LANES, async (serviceId) => {
    try {
      const res = await api.services[":id"].inspectors.$get({ param: { id: serviceId } });
      if (!res.ok) return [serviceId, [] as string[]] as const;
      const body = (await res.json()) as { data?: { userIds?: unknown } };
      const ids = body.data?.userIds;
      return [serviceId, (Array.isArray(ids) ? ids : []) as string[]] as const;
    } catch {
      // A restriction read failing must not take down the services page.
      return [serviceId, [] as string[]] as const;
    }
  });
  return Object.fromEntries(rows);
}

export async function loadServiceFanout(
  api: Api,
  serviceIds: string[],
): Promise<{ restrictionMap: Record<string, string[]>; payRuleMap: Record<string, PayRule[]> }> {
  const [restrictionMap, payRuleMap] = await Promise.all([
    loadRestrictionMap(api, serviceIds),
    loadPayRuleMap(api, serviceIds),
  ]);
  return { restrictionMap, payRuleMap };
}
