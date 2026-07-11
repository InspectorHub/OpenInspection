/**
 * Standalone inspection report page.
 *
 * The render + all pure helpers now live in
 * `app/components/portal/sections/ReportView.tsx` so the report can ALSO be
 * rendered inline inside the unified client-portal Hub (section ②) and reused by
 * the agent report (?view=agent → same route). This file is a thin wrapper: it
 * keeps the loader (data fetching is route-specific) and maps the loader payload
 * through `reportViewProps()` into <ReportView>.
 */
import { useLoaderData, useParams, useSearchParams } from "react-router";
import type { Route } from "./+types/report-card-stack";
import { createApi } from "~/lib/api-client.server";
import { getToken } from "~/lib/session.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND } from "~/lib/brand";
import {
  ReportView,
  reportViewProps,
  type ReportLoaderResult,
  type FilterKey,
} from "~/components/portal/sections/ReportView";

// Re-export the pure signature/verification helpers from their new home so that
// existing imports (tests + any consumers) of `~/routes/public/report-card-stack`
// keep working unchanged.
export {
  signatureBlockModel,
  verificationBlockModel,
  type SignatureBlockResult,
  type VerificationBlockResult,
  // Print-layout constants (PRINT-only; on-screen rendering unchanged). The
  // grids + cards live in <ReportView>; these document/test the intent.
  PRINT_CARD_CLASS,
  PRINT_FIGURE_CLASS,
  PRINT_SECTION_HEADING_CLASS,
  DEFECT_PHOTO_GRID_CLASS,
  ITEM_PHOTO_GRID_CLASS,
  printThumbWidth,
} from "~/components/portal/sections/ReportView";

// Loader-local alias for the shared payload type.
type LoaderResult = ReportLoaderResult;

export function meta({ data }: Route.MetaArgs) {
 const d = data as LoaderResult | undefined;
 return [{ title: `Report - ${d?.address ?? "Inspection"} - OpenInspection` }];
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ params, request, context }: Route.LoaderArgs) {
 const initialFilter: FilterKey =
   new URL(request.url).searchParams.get("summary") === "1" ? "summary" : "all";
 // Headless PDF renders carry ?print=1 (appended by generatePdfFromUrl). In that
 // mode load images eagerly: Browser Rendering never scrolls, so loading={data.printMode ? "eager" : "lazy"}
 // images below the fold would never load and the PDF would have blank photos.
 const printMode = new URL(request.url).searchParams.get("print") === "1";
 const parsedUrl = new URL(request.url);
 const baseUrl = parsedUrl.origin;
 try {
 // Relay the owner's session JWT when present so the inspector/admin can
 // preview their own report tokenlessly (resolveOwnerPreview server-side).
 // Public client viewers carry no session → getToken returns null → unchanged.
 const sessionToken = (await getToken(context, request)) ?? undefined;
 // ownerPreview: the inspector/admin is viewing their own report via their
 // session (no public ?token= needed). sessionToken present = owner session.
 const ownerPreview = sessionToken != null;
 const api = createApi(context, { token: sessionToken });
 const token = parsedUrl.searchParams.get("token") ?? undefined;
 // Forward the server-minted render token (headless PDF generation). The
 // Browser Rendering browser loads /report-view/:tenant/:id?render=<token>;
 // the data route resolves the tenant from it (see public-report.ts). Without
 // forwarding it here the headless render gets "Report not found".
 const render = parsedUrl.searchParams.get("render") ?? undefined;
 const [res, brand] = await Promise.all([
 api.publicReport.report[":tenant"][":id"].$get({
 param: { tenant: params.tenant ?? "", id: params.id ?? "" },
 query: { token, render },
 }),
 resolveTenantBrand(context, params.tenant),
 ]);
 const body = res.ok ? await res.json() : {};
 const d = ((body as Record<string, unknown>).data ?? {}) as unknown as LoaderResult | undefined;
 // getReportData nests property/inspector/date under `inspection` and names
 // the theme `theme`. Read those (falling back to any top-level aliases) so the
 // report header shows the real address + inspector instead of blanks.
 const meta = d as unknown as {
   inspection?: { propertyAddress?: string | null; date?: string | null; inspectorName?: string | null };
   theme?: string;
 } | undefined;
 const raw = d as unknown as Record<string, unknown> | undefined;
 return {
 inspectionId: d?.inspectionId ?? params.id ?? "",
 address: d?.address ?? meta?.inspection?.propertyAddress ?? "",
 date: d?.date ?? meta?.inspection?.date ?? "",
 inspectorName: d?.inspectorName ?? meta?.inspection?.inspectorName ?? null,
 coverPhotoUrl: d?.coverPhotoUrl ?? null,
 stats: d?.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
 sections: d?.sections ?? [],
 outline: (raw?.outline as LoaderResult["outline"] | undefined) ?? [],
 showEstimates: d?.showEstimates ?? false,
 costTables: (raw?.costTables as LoaderResult["costTables"] | undefined) ?? null,
 enableRepairList: d?.enableRepairList ?? false,
 enableCustomerRepairExport: d?.enableCustomerRepairExport ?? false,
 isDelivered: d?.isDelivered ?? false,
 brand,
 error: res.ok ? null : "Report not found",
 notPublished: (res.status as number) === 403,
 reportTheme: (raw?.reportTheme as string | undefined) ?? meta?.theme,
 initialFilter,
 printMode,
 isPublished: (raw?.isPublished as boolean | undefined) ?? false,
 signature: (raw?.signature as LoaderResult["signature"] | undefined) ?? null,
 verification: (raw?.verification as LoaderResult["verification"] | undefined) ?? null,
 astmConformance: (raw?.astmConformance as LoaderResult["astmConformance"] | undefined) ?? null,
 reportSignoffs: (raw?.reportSignoffs as LoaderResult["reportSignoffs"] | undefined) ?? [],
 psq: (raw?.psq as LoaderResult["psq"] | undefined) ?? null,
 documentReview: (raw?.documentReview as LoaderResult["documentReview"] | undefined) ?? [],
 relianceText: (raw?.relianceText as LoaderResult["relianceText"] | undefined) ?? { userReliance: "", pointInTime: "", siteSpecific: "" },
 ownerPreview,
 baseUrl,
 photoMode: (raw?.photoMode as LoaderResult["photoMode"] | undefined) ?? "inline",
 photoAppendix: (raw?.photoAppendix as LoaderResult["photoAppendix"] | undefined) ?? [],
 propertyType: (raw?.propertyType as string | undefined) ?? null,
 commercialSubtype: (raw?.commercialSubtype as string | undefined) ?? null,
 reportTier: (raw?.reportTier as LoaderResult["reportTier"] | undefined) ?? null,
 buildingProfile: (raw?.buildingProfile as LoaderResult["buildingProfile"] | undefined) ?? [],
 pcaReport: (raw?.pcaReport as LoaderResult["pcaReport"] | undefined) ?? null,
 unitInspectionMode: (raw?.unitInspectionMode as 'tagged' | 'per_unit' | undefined) ?? 'tagged',
 units: (raw?.units as LoaderResult["units"] | undefined) ?? [],
 unitConditionMatrix: (raw?.unitConditionMatrix as LoaderResult["unitConditionMatrix"] | undefined) ?? [],
 defectCountsByUnit: (raw?.defectCountsByUnit as LoaderResult["defectCountsByUnit"] | undefined) ?? {},
 } satisfies LoaderResult;
 } catch {
 return {
 inspectionId: "",
 address: "",
 date: "",
 inspectorName: null,
 stats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
 sections: [],
 outline: [],
 showEstimates: false,
 costTables: null,
 enableRepairList: false,
 enableCustomerRepairExport: false,
 isDelivered: false,
 brand: EMPTY_BRAND,
 coverPhotoUrl: null,
 error: "Service unavailable",
 notPublished: false,
 initialFilter,
 printMode,
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
 } satisfies LoaderResult;
 }
}

/* ------------------------------------------------------------------ */
/* Action — Commercial PCA Phase W Task 6 "Export to Word" BFF relay.   */
/* Owner-only: <WordExportButton> only mounts when the loader's         */
/* `ownerPreview` is true, but this action independently requires a     */
/* session token (defense in depth — the same route also serves the     */
/* public token viewer, which never renders the button but could in     */
/* principle POST here directly).                                       */
/* ------------------------------------------------------------------ */

type ExportWordActionResult =
 | { ok: true; intent: "export-word-enqueue"; exportId: string }
 | { ok: false; intent: "export-word-enqueue"; code?: string; error?: string }
 | { ok: true; intent: "export-word-status"; status: "queued" | "building" | "ready" | "failed"; error?: string | null }
 | { ok: false; intent: "export-word-status"; error?: string };

export async function action({ request, params, context }: Route.ActionArgs) {
 const formData = await request.formData();
 const intent = formData.get("intent");
 const id = params.id ?? "";

 const sessionToken = (await getToken(context, request)) ?? undefined;
 if (!sessionToken) {
 return { ok: false, intent: String(intent ?? "") } as ExportWordActionResult;
 }
 const api = createApi(context, { token: sessionToken });

 if (intent === "export-word-enqueue") {
 const res = await api.inspections[":id"].export.word.$post({ param: { id } });
 if (!res.ok) {
 const bodyText = await res.text().catch(() => "");
 let code: string | undefined;
 let message = "Couldn't start the Word export. Please try again.";
 try {
 const parsed = JSON.parse(bodyText) as { error?: { code?: string; message?: string } };
 code = parsed?.error?.code;
 message = parsed?.error?.message ?? message;
 } catch {
 /* non-JSON body — keep the default message */
 }
 return { ok: false, intent: "export-word-enqueue", code, error: message } satisfies ExportWordActionResult;
 }
 const body = await res.json();
 return { ok: true, intent: "export-word-enqueue", exportId: body.data.exportId } satisfies ExportWordActionResult;
 }

 if (intent === "export-word-status") {
 const exportId = String(formData.get("exportId") ?? "");
 if (!exportId) {
 return { ok: false, intent: "export-word-status", error: "Missing exportId" } satisfies ExportWordActionResult;
 }
 const res = await api.inspections[":id"].export[":exportId"].$get({ param: { id, exportId } });
 if (!res.ok) {
 return { ok: false, intent: "export-word-status", error: "Export not found" } satisfies ExportWordActionResult;
 }
 const body = await res.json();
 return {
 ok: true,
 intent: "export-word-status",
 status: body.data.status,
 error: body.data.error ?? null,
 } satisfies ExportWordActionResult;
 }

 return { ok: false, intent: String(intent ?? "") } as ExportWordActionResult;
}

/* ------------------------------------------------------------------ */
/* Page — thin wrapper around <ReportView> */
/* ------------------------------------------------------------------ */

export default function ReportCardStackPage() {
 const data = useLoaderData<typeof loader>() as LoaderResult;
 const params = useParams();
 const [searchParams] = useSearchParams();
 return (
 <ReportView
 {...reportViewProps({
 ...data,
 tenant: params.tenant,
 inspectionId: params.id ?? data.inspectionId,
 token: searchParams.get("token") ?? undefined,
 // Standalone page keeps the full page chrome (min-h-screen background +
 // big property-address title). The inline Hub mount omits this flag so
 // the report renders bare (no double background, address shown once).
 showStandaloneChrome: true,
 })}
 />
 );
}
