/**
 * Task 6 — BFF resource route for the repair-item (Recommendations) catalog.
 *
 * The editor's RepairItemsPanel attaches repair items to a finding. It needs
 * the tenant's repair-item catalog (severity, default estimate, default repair
 * summary) joined with the suggested contractor type's display name. Client
 * code never fetches `/api` directly (Token-Relay rule), so this route is the
 * relay: loader-only, mirrors `comments-library.tsx`.
 *
 * No UI — resource route (loader only).
 */
import type { Route } from "./+types/repair-items";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export interface RepairItemOption {
  id: string;
  name: string;
  category: string | null;
  defaultEstimateMin: number | null;
  defaultEstimateMax: number | null;
  defaultRepairSummary: string;
  contractorTypeName: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (!token) return { items: [] as RepairItemOption[] };
  const api = createApi(context, { token });
  try {
    const [recRes, ctRes] = await Promise.all([
      api.recommendations.index.$get({ query: {} }, { headers: { "x-token-relay": "1" } }),
      api.contractorTypes.index.$get({}, { headers: { "x-token-relay": "1" } }),
    ]);
    if (!recRes.ok) return { items: [] as RepairItemOption[] };
    const recs = ((await recRes.json()) as { data?: Array<{ id: string; name: string; category: string | null; defaultEstimateMin: number | null; defaultEstimateMax: number | null; defaultRepairSummary: string; recommendedContractorTypeId: string | null }> }).data ?? [];
    const cts = ctRes.ok ? (((await ctRes.json()) as { data?: Array<{ id: string; name: string }> }).data ?? []) : [];
    const ctName = new Map(cts.map((c) => [c.id, c.name]));
    return {
      items: recs.map((r) => ({
        id: r.id, name: r.name, category: r.category,
        defaultEstimateMin: r.defaultEstimateMin, defaultEstimateMax: r.defaultEstimateMax,
        defaultRepairSummary: r.defaultRepairSummary,
        contractorTypeName: r.recommendedContractorTypeId ? (ctName.get(r.recommendedContractorTypeId) ?? null) : null,
      })),
    };
  } catch {
    return { items: [] as RepairItemOption[] };
  }
}
