/**
 * Per-section loader factory for the unified client-portal Hub.
 *
 * Extracted verbatim from app/routes/public/portal-inspection.tsx (behavior-
 * preserving): the route's loader keeps the SAME ?section= branching and returns
 * the SAME shapes — it just delegates the per-section fetch to the functions here.
 *
 * Each loader mirrors the corresponding standalone route loader's wire→view
 * mapping, authenticated with the portal per-inspection token (ctx.token), the
 * recipient's email-matched signer token, or the forwarded portal-session cookie,
 * exactly as documented per-section below.
 */
import type { AppLoadContext } from "react-router";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND } from "~/lib/brand";
import type { HubSection } from "~/components/portal/InspectionHub";
import {
  reportViewProps,
  type ReportLoaderResult,
  type FilterKey,
} from "~/components/portal/sections/ReportView";
import { type ProgressSection } from "~/components/portal/sections/ProgressView";
import {
  type LoaderResult as RepairLoaderResult,
  type Defect as RepairDefect,
  type RepairRequest,
} from "~/components/portal/sections/RepairBuilderSection";
import { type AgreementData } from "~/components/portal/sections/AgreementSection";
import { type InvoiceData } from "~/components/portal/sections/PaymentSection";
import type { TenantBrand } from "~/lib/brand";

/* ------------------------------------------------------------------ */
/* Section validation */
/* ------------------------------------------------------------------ */

export const HUB_SECTIONS: HubSection[] = [
  "overview",
  "report",
  "agreement",
  "payment",
  "progress",
  "messages",
  "repair",
  "documents",
];

export function parseSection(v: string | null): HubSection {
  return v !== null && (HUB_SECTIONS as string[]).includes(v) ? (v as HubSection) : "overview";
}

// Sections the ?to= email-CTA may jump to (every real Hub section except the
// default "overview", which needs no redirect).
export function isJumpSection(v: string | null): v is HubSection {
  return v !== null && v !== "overview" && (HUB_SECTIONS as string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Report section data — mirrors the standalone report loader mapping,
 * authenticated with the portal per-inspection token (ctx.token). */
/* ------------------------------------------------------------------ */

export async function loadReportSection(
  context: AppLoadContext,
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
    const [res, brand] = await Promise.all([
      api.publicReport.report[":tenant"][":id"].$get({
        param: { tenant, id: inspectionId },
        query: { token: token || undefined },
      }),
      resolveTenantBrand(context, tenant),
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
      brand,
      error: res.ok ? null : "Report not found",
      notPublished: (res.status as number) === 403,
      reportTheme: (raw?.reportTheme as string | undefined) ?? meta?.theme,
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
      error: "Service unavailable",
      notPublished: false,
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

/* ------------------------------------------------------------------ */
/* Progress section data — served via the portal-session-authed observe
 * endpoint (membership-checked), NOT the observer-link token. The portal
 * client is already authenticated by the __Host-portal_session cookie, which
 * is forwarded into the API call exactly like the overview call. */
/* ------------------------------------------------------------------ */

export interface ProgressLoaderResult {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: ProgressSection[];
  error: string | null;
}

export async function loadProgressSection(
  context: AppLoadContext,
  tenant: string,
  inspectionId: string,
  cookieForApi: string,
): Promise<ProgressLoaderResult> {
  try {
    const api = createApi(context);
    const res = await api.portal[":tenant"].inspections[":inspectionId"].observe.$get(
      { param: { tenant, inspectionId } },
      { headers: { Cookie: cookieForApi } },
    );
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    const has = Object.keys(d).length > 0;
    return {
      address: (d.address as string | undefined) ?? "",
      date: (d.date as string | null | undefined) ?? null,
      inspectorName: (d.inspectorName as string | undefined) ?? "",
      status: (d.status as string | undefined) ?? "",
      sections: (d.sections as ProgressSection[] | undefined) ?? [],
      error: res.ok && has ? null : "Inspection not found",
    };
  } catch {
    return {
      address: "",
      date: null,
      inspectorName: "",
      status: "",
      sections: [],
      error: "Service unavailable",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Repair section data — mirrors the standalone repair-builder loader mapping,
 * authenticated with the portal per-inspection token (ctx.token). */
/* ------------------------------------------------------------------ */

export async function loadRepairSection(
  context: AppLoadContext,
  tenant: string,
  inspectionId: string,
  token: string,
): Promise<RepairLoaderResult> {
  try {
    const api = createApi(context);
    const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].source.$get({
      param: { tenant, id: inspectionId },
      query: { token: token || undefined },
    });

    if (res.status === 401) return { kind: "no_access" };
    if (res.status === 403) {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body?.error?.code === "NOT_PUBLISHED") return { kind: "not_published" };
      return { kind: "forbidden" };
    }
    if (!res.ok) return { kind: "error" };

    const body = (await res.json()) as {
      data?: { defects: RepairDefect[]; mine: RepairRequest[] };
    };
    const data = body.data;
    if (!data) return { kind: "error" };

    return {
      kind: "ok",
      defects: data.defects,
      mine: data.mine,
      tenant,
      id: inspectionId,
      token: token || null,
    };
  } catch {
    return { kind: "error" };
  }
}

/* ------------------------------------------------------------------ */
/* Payment section data — mirrors the standalone invoice loader mapping.
 * The pay flow is keyed by INSPECTION ID (pay-intent + invoice both by id),
 * so no per-inspection token is required here. */
/* ------------------------------------------------------------------ */

export interface InvoiceLoaderResult {
  invoice: InvoiceData | null;
  brand: TenantBrand;
  error: string | null;
}

/** Wire shape of GET /api/public/inspections/:id/invoice (cents + ISO dates + brand). */
interface RawInvoice {
  id: string;
  amountCents: number;
  status: string;
  createdAt?: string | null;
  dueDate?: string | null;
  clientName?: string | null;
  lineItems?: { description: string; amountCents: number }[];
  brand?: TenantBrand;
}

export async function loadInvoiceSection(
  context: AppLoadContext,
  inspectionId: string,
): Promise<InvoiceLoaderResult> {
  try {
    const api = createApi(context);
    const res = await api.publicReport.inspections[":id"].invoice.$get({ param: { id: inspectionId } });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? null) as RawInvoice | null;
    const invoice: InvoiceData | null = d
      ? {
          number: `INV-${d.id.slice(0, 8).toUpperCase()}`,
          date: d.createdAt?.slice(0, 10) ?? "",
          dueDate: d.dueDate ?? null,
          status: (d.status as InvoiceData["status"]) ?? "draft",
          clientName: d.clientName ?? "",
          inspectorName: "",
          lineItems: (d.lineItems ?? []).map((li) => ({ description: li.description, amount: li.amountCents / 100 })),
          total: d.amountCents / 100,
        }
      : null;
    return {
      invoice,
      brand: d?.brand ?? EMPTY_BRAND,
      error: res.ok ? null : "Invoice not found",
    };
  } catch {
    return { invoice: null, brand: EMPTY_BRAND, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/* Agreement section data — mirrors the standalone agreement-sign loader.
 * Fetched with the recipient's OWN email-matched signer token (NOT the
 * per-inspection access token). The overview endpoint resolves that token
 * server-side (email-matched, never cross-signer). A null signerToken means the
 * recipient is not a signer → no agreement to render. */
/* ------------------------------------------------------------------ */

export interface AgreementLoaderResult {
  agreement: AgreementData | null;
  error: string | null;
}

export async function loadAgreementSection(
  context: AppLoadContext,
  signerToken: string | null,
): Promise<AgreementLoaderResult> {
  if (!signerToken) return { agreement: null, error: null };
  try {
    const api = createApi(context);
    const res = (await api.bookings.agreements[":token"].$get({
      param: { token: signerToken },
    })) as unknown as Response;
    const body = res.ok ? ((await res.json()) as { data?: AgreementData }) : {};
    const d = (body as { data?: AgreementData }).data ?? null;
    return { agreement: d, error: res.ok ? null : "Agreement not found" };
  } catch {
    return { agreement: null, error: "Service unavailable" };
  }
}

export { reportViewProps };
