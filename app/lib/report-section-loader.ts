/**
 * Report section data for the unified client-portal Hub.
 *
 * Extracted from `app/lib/section-loaders.ts` (pure movement) for the same
 * reason `agent-report-context.ts` was: it is by far the largest of the
 * per-section loaders — the wire→view mapping of the published report is ~120
 * lines of field defaulting — and it shares nothing with its neighbours beyond
 * the LoadContext. `section-loaders.ts` re-exports it, so every existing
 * importer keeps its import path.
 *
 * Mirrors the standalone report loader's mapping, authenticated with the portal
 * per-inspection token (ctx.token).
 */
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { readViewTrackingObjected } from "~/lib/view-tracking.server";
import { EMPTY_BRAND } from "~/lib/brand";
import type {
  ReportLoaderResult,
  FilterKey,
} from "~/components/portal/sections/ReportView";
import type { LoadContext } from "~/lib/load-context";

export async function loadReportSection(
  context: LoadContext,
  request: Request,
  tenant: string,
  inspectionId: string,
  token: string,
): Promise<ReportLoaderResult> {
  const parsedUrl = new URL(request.url);
  const baseUrl = parsedUrl.origin;
  const initialFilter: FilterKey = "all";
  const printMode = false;
  // The inline client-portal Hub mount never runs the headless PDF path, so
  // there is no `?tocpages=` param to resolve here (mirrors printMode = false).
  try {
    const api = createApi(context);
    // OI #271 — resolved with the report, for the same reason the standalone
    // route does it: the Art. 21 control has to render with the right label
    // server-side. Both portal entry paths are relayed (the hub reader has a
    // session cookie, the emailed-link reader has `?token=`).
    const [res, brand, viewTrackingObjected] = await Promise.all([
      api.publicReport.report[":tenant"][":id"].$get({
        param: { tenant, id: inspectionId },
        query: { token: token || undefined },
      }),
      resolveTenantBrand(context, tenant, request),
      readViewTrackingObjected(context, {
        inspectionId,
        token: token || undefined,
        cookie: request.headers.get("cookie") ?? undefined,
      }),
    ]);
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as unknown as ReportLoaderResult | undefined;
    const meta = d as unknown as {
      inspection?: { propertyAddress?: string | null; date?: string | null; inspectorName?: string | null };
      theme?: string;
    } | undefined;
    const raw = d as unknown as Record<string, unknown> | undefined;
    return {
      inspectionId: d?.inspectionId ?? inspectionId,
      address: d?.address ?? meta?.inspection?.propertyAddress ?? "",
      date: d?.date ?? meta?.inspection?.date ?? "",
      inspectorName: d?.inspectorName ?? meta?.inspection?.inspectorName ?? null,
      coverPhotoUrl: d?.coverPhotoUrl ?? null,
      stats: d?.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
      sections: d?.sections ?? [],
      outline: (raw?.outline as ReportLoaderResult["outline"] | undefined) ?? [],
      showEstimates: d?.showEstimates ?? false,
      costTables: (raw?.costTables as ReportLoaderResult["costTables"] | undefined) ?? null,
      enableRepairList: d?.enableRepairList ?? false,
      enableCustomerRepairExport: d?.enableCustomerRepairExport ?? false,
      reportTimeZone: d?.reportTimeZone ?? "UTC",
      isDelivered: d?.isDelivered ?? false,
      viewTrackingObjected,
      brand,
      error: res.ok ? null : m.helper_section_report_not_found(),
      notPublished: (res.status as number) === 403,
      linkInactive: (res.status as number) === 410,
      styleProfile: raw?.styleProfile as ReportLoaderResult["styleProfile"],
      inspectorCredentials: raw?.inspectorCredentials as ReportLoaderResult["inspectorCredentials"],
      initialFilter,
      printMode,
      tocPages: undefined,
      isPublished: (raw?.isPublished as boolean | undefined) ?? false,
      signature: (raw?.signature as ReportLoaderResult["signature"] | undefined) ?? null,
      verification: (raw?.verification as ReportLoaderResult["verification"] | undefined) ?? null,
      astmConformance: (raw?.astmConformance as ReportLoaderResult["astmConformance"] | undefined) ?? null,
      reportSignoffs: (raw?.reportSignoffs as ReportLoaderResult["reportSignoffs"] | undefined) ?? [],
      psq: (raw?.psq as ReportLoaderResult["psq"] | undefined) ?? null,
      documentReview: (raw?.documentReview as ReportLoaderResult["documentReview"] | undefined) ?? [],
      relianceText: (raw?.relianceText as ReportLoaderResult["relianceText"] | undefined) ?? { userReliance: "", pointInTime: "", siteSpecific: "" },
      ownerPreview: false,
      baseUrl,
      photoMode: (raw?.photoMode as ReportLoaderResult["photoMode"] | undefined) ?? "inline",
      photoAppendix: (raw?.photoAppendix as ReportLoaderResult["photoAppendix"] | undefined) ?? [],
      propertyType: (raw?.propertyType as string | undefined) ?? null,
      commercialSubtype: (raw?.commercialSubtype as string | undefined) ?? null,
      reportTier: (raw?.reportTier as ReportLoaderResult["reportTier"] | undefined) ?? null,
      buildingProfile: (raw?.buildingProfile as ReportLoaderResult["buildingProfile"] | undefined) ?? [],
      pcaReport: (raw?.pcaReport as ReportLoaderResult["pcaReport"] | undefined) ?? null,
      unitInspectionMode: (raw?.unitInspectionMode as 'tagged' | 'per_unit' | undefined) ?? 'tagged',
      units: (raw?.units as ReportLoaderResult["units"] | undefined) ?? [],
      unitConditionMatrix: (raw?.unitConditionMatrix as ReportLoaderResult["unitConditionMatrix"] | undefined) ?? [],
      defectCountsByUnit: (raw?.defectCountsByUnit as ReportLoaderResult["defectCountsByUnit"] | undefined) ?? {},
    } satisfies ReportLoaderResult;
  } catch {
    return {
      inspectionId,
      address: "",
      date: "",
      inspectorName: null,
      coverPhotoUrl: null,
      stats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
      sections: [],
      outline: [],
      showEstimates: false,
      costTables: null,
      enableRepairList: false,
      enableCustomerRepairExport: false,
      reportTimeZone: "UTC",
      isDelivered: false,
      brand: EMPTY_BRAND,
      error: m.helper_section_service_unavailable(),
      notPublished: false,
      linkInactive: false,
      initialFilter,
      printMode,
      tocPages: undefined,
      isPublished: false,
      signature: null,
      verification: null,
      astmConformance: null,
      reportSignoffs: [],
      psq: null,
      documentReview: [],
      relianceText: { userReliance: "", pointInTime: "", siteSpecific: "" },
      ownerPreview: false,
      baseUrl,
      photoMode: "inline",
      photoAppendix: [],
      propertyType: null,
      commercialSubtype: null,
      reportTier: null,
      buildingProfile: [],
      pcaReport: null,
      unitInspectionMode: 'tagged',
      units: [],
      unitConditionMatrix: [],
      defectCountsByUnit: {},
    } satisfies ReportLoaderResult;
  }
}

