/**
 * Commercial PCA Phase C Task 13b — BFF resource route for CostItemsPanel.
 *
 * Client code never fetches `/api/*` directly (Token-Relay rule — see
 * `reference_core_bff_no_client_fetch`); this route is the relay, mirroring
 * `repair-items.tsx` (loader) and `defect-categories.tsx` (action / intent
 * dispatch) onto the Task 13a `/api/inspections/:id/cost-items` CRUD routes.
 *
 * loader: GET  ?inspectionId= -> { items: CostItemView[], reserveEnabled }
 * action: POST intent=create|update|delete -> { success, id? }
 *
 * `reserveEnabled` (tenant `reserveScheduleEnabled`) is piggybacked onto the
 * `/api/inspections/:id/cost-items` list response (see the `listCostItemsRoute`
 * handler in `server/api/inspections/cost-items.ts`, fix wave, task-13b-
 * report.md) rather than read directly here via Drizzle: `app/` and `server/`
 * are separate tsc programs (tsconfig.json excludes `server/**`, which only
 * `tsconfig.api.json` includes), so this loader never imports `server/lib/db/
 * schema` — it only ever reaches data through the `hc`-typed `createApi`
 * client, same as every other `app/routes/resources/*` route.
 */
import type { Route } from "./+types/cost-items";
import { getToken, requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { CostItemView } from "~/components/portal/sections/report/types";

const EMPTY = { items: [] as CostItemView[], reserveEnabled: false };

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (!token) return EMPTY;

  const inspectionId = new URL(request.url).searchParams.get("inspectionId") ?? "";
  if (!inspectionId) return EMPTY;

  const api = createApi(context, { token });
  try {
    const res = await api.inspections[":id"]["cost-items"].$get(
      { param: { id: inspectionId } },
      { headers: { "x-token-relay": "1" } },
    );
    if (!res.ok) return EMPTY;
    const body = (await res.json()) as { data?: CostItemView[]; reserveEnabled?: boolean };
    return { items: body.data ?? [], reserveEnabled: Boolean(body.reserveEnabled) };
  } catch {
    return EMPTY;
  }
}

function readCostItemJson(fd: FormData) {
  const num = (key: string): number | undefined => {
    const raw = fd.get(key);
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (key: string): string | undefined => {
    const raw = fd.get(key);
    return typeof raw === "string" && raw !== "" ? raw : undefined;
  };
  return {
    system: String(fd.get("system") ?? ""),
    component: String(fd.get("component") ?? ""),
    location: str("location"),
    action: String(fd.get("action") ?? "repair") as "repair" | "replace" | "further_study",
    costMethod: String(fd.get("costMethod") ?? "lump_sum") as "unit" | "lump_sum",
    quantity: num("quantity") ?? null,
    uom: str("uom") ?? null,
    unitCostCents: num("unitCostCents") ?? null,
    lumpSumCents: num("lumpSumCents") ?? null,
    eul: num("eul") ?? null,
    effAge: num("effAge") ?? null,
    rul: num("rul") ?? null,
    suggestedRemedy: str("suggestedRemedy") ?? "",
    bucket: String(fd.get("bucket") ?? "immediate") as "immediate" | "short_term" | "long_term",
    sortOrder: num("sortOrder"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const inspectionId = String(fd.get("inspectionId") ?? "");
  if (!inspectionId) return { success: false as const, error: "Missing inspectionId" };

  const hdr = { headers: { "x-token-relay": "1" } } as const;

  try {
    if (intent === "delete") {
      const itemId = String(fd.get("itemId") ?? "");
      if (!itemId) return { success: false as const, error: "Missing itemId" };
      const res = await api.inspections[":id"]["cost-items"][":itemId"].$delete(
        { param: { id: inspectionId, itemId } },
        hdr,
      );
      return { success: res.ok };
    }

    if (intent === "update") {
      const itemId = String(fd.get("itemId") ?? "");
      if (!itemId) return { success: false as const, error: "Missing itemId" };
      const res = await api.inspections[":id"]["cost-items"][":itemId"].$patch(
        { param: { id: inspectionId, itemId }, json: readCostItemJson(fd) },
        hdr,
      );
      if (!res.ok) return { success: false as const, error: `HTTP ${res.status}` };
      return { success: true as const };
    }

    if (intent === "create") {
      const res = await api.inspections[":id"]["cost-items"].$post(
        { param: { id: inspectionId }, json: readCostItemJson(fd) },
        hdr,
      );
      if (!res.ok) return { success: false as const, error: `HTTP ${res.status}` };
      const body = (await res.json()) as { data?: { id: string } };
      return { success: true as const, id: body.data?.id };
    }

    return { success: false as const, error: "Unknown intent" };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "Failed" };
  }
}
