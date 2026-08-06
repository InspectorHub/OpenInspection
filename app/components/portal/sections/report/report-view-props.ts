/**
 * <ReportView>'s prop contract and the pure adapter that produces it.
 *
 * Kept out of the component module because this is the report's INPUT
 * boundary, not part of its render: three different callers (the standalone
 * `/report-view/...` route, the agent view of that same route, and the inline
 * Hub slot) each hold a loader payload plus a few route params, and every one
 * of them goes through `reportViewProps()`. Having it importable without
 * pulling in React is what lets it be unit-tested directly.
 *
 * ReportView re-exports both symbols, so its public surface is unchanged.
 */
import type { ReportLoaderResult } from "./types";

export interface ReportViewProps extends ReportLoaderResult {
  /** Route params, supplied by the wrapper (not from loader payload). */
  tenant: string;
  /** The inspection id (params); falls back to loader inspectionId. */
  reportId: string;
  /** Public access token (?token=) used for token-scoped action links. */
  token?: string;
  /**
   * When true (the STANDALONE `/report-view/...` page) the component renders its
   * own full-page chrome: a `min-h-screen` page background and the big property-
   * ADDRESS title block. When false (default — rendered INLINE inside the Hub)
   * that chrome is dropped: the Hub already supplies the page container, header
   * and address, so the bare report content is rendered to avoid a double
   * background and a duplicated address. The functional bits (filters, toolbar,
   * Download-PDF FAB, signature/verification, lightbox) render in BOTH modes.
   * Mirrors `PaymentSection`'s `showStandaloneChrome` convention.
   */
  showStandaloneChrome?: boolean;
  /** Spec 3: hide client-transaction affordances (repair-list / build-repair
   *  links + the in-report Repair Request toggle) when an AGENT is viewing the
   *  report via their link. Report-viewing actions (Print, Download PDF) stay. */
  hideClientActions?: boolean;
}

/**
 * Pure adapter: loader payload (+ route params) → component props. Unit-testable
 * (no React / router). Defensive defaults keep it safe against partial payloads.
 */
export function reportViewProps(
  data: ReportLoaderResult & {
    tenant?: string;
    inspectionId?: string;
    token?: string;
    showStandaloneChrome?: boolean;
  },
): ReportViewProps {
  const reportId = data.inspectionId ?? "";
  return {
    inspectionId: data.inspectionId ?? "",
    address: data.address ?? "",
    date: data.date ?? "",
    inspectorName: data.inspectorName ?? null,
    coverPhotoUrl: data.coverPhotoUrl ?? null,
    stats: data.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
    sections: data.sections ?? [],
    outline: data.outline ?? [],
    showEstimates: data.showEstimates ?? false,
    costTables: data.costTables ?? null,
    enableRepairList: data.enableRepairList ?? false,
    enableCustomerRepairExport: data.enableCustomerRepairExport ?? false,
    reportTimeZone: data.reportTimeZone ?? "UTC",
    isDelivered: data.isDelivered ?? false,
    brand: data.brand,
    error: data.error ?? null,
    notPublished: data.notPublished ?? false,
    linkInactive: data.linkInactive ?? false,
    styleProfile: data.styleProfile,
    inspectorCredentials: data.inspectorCredentials,
    initialFilter: data.initialFilter ?? "all",
    printMode: data.printMode ?? false,
    tocPages: data.tocPages,
    isPublished: data.isPublished ?? false,
    signature: data.signature ?? null,
    verification: data.verification ?? null,
    astmConformance: data.astmConformance ?? null,
    reportSignoffs: data.reportSignoffs ?? [],
    psq: data.psq ?? null,
    documentReview: data.documentReview ?? [],
    relianceText: data.relianceText ?? { userReliance: "", pointInTime: "", siteSpecific: "" },
    ownerPreview: data.ownerPreview ?? false,
    baseUrl: data.baseUrl ?? "",
    photoMode: data.photoMode ?? "inline",
    photoAppendix: data.photoAppendix ?? [],
    propertyType: data.propertyType ?? null,
    commercialSubtype: data.commercialSubtype ?? null,
    reportTier: data.reportTier ?? null,
    buildingProfile: data.buildingProfile ?? [],
    pcaReport: data.pcaReport ?? null,
    unitInspectionMode: data.unitInspectionMode ?? "tagged",
    units: data.units ?? [],
    unitConditionMatrix: data.unitConditionMatrix ?? [],
    defectCountsByUnit: data.defectCountsByUnit ?? {},
    tenant: data.tenant ?? "",
    reportId,
    token: data.token,
    showStandaloneChrome: data.showStandaloneChrome ?? false,
  };
}
