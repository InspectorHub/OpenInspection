/**
 * Shared report types + print-layout constants.
 *
 * Extracted from <ReportView> so the colocated report sub-components and the
 * pure helpers can reference them without importing the component module
 * (avoids a circular import). ReportView re-exports every symbol here, so its
 * public type/constant surface is unchanged.
 */
import type { TenantBrand } from "~/lib/brand";
import type { ReportMedia } from "../../../../../server/lib/report-video";

/** Plan 7 — a report photo object may carry a resolved media kind (video). */
export type ReportPhoto = { key: string; url: string; media?: ReportMedia };

/** Commercial PCA Phase F — a resolved Building Profile display row (server produces these). */
export interface ProfileRow {
  id: string;
  group: string;
  label: string;
  value: string | number | null;
  unit: string | null;
}

export interface ResolvedDefect {
  id: string;
  title: string;
  included: boolean;
  isCustom?: boolean;
  effectiveComment: string;
  effectiveCategory?: string;
  /** Authoring unification Plan-4 module K — the tenant's configured
   *  defect_categories.color for effectiveCategory, resolved server-side.
   *  Undefined → DefectCategoryChip's tokened/muted fallback. */
  categoryColor?: string;
  /** Whether this defect's category counts toward the report Summary rollup
   *  (defect_categories.drivesSummary), resolved server-side. */
  drivesSummary?: boolean;
  effectiveLocation?: string | null;
  defectPhotos?: ReportPhoto[];
}

export interface ReportItem {
  id: string;
  label: string;
  type?: string;
  rating: string | null;
  ratingColor: string;
  ratingLabel: string | null;
  severityBucket: string;
  /** Commercial PCA Phase F (F1) — NI/NP distinction (null for non-na items). */
  naKind?: 'not_inspected' | 'not_present' | null;
  /** Commercial PCA Phase F (F1) — optional limitation reason captured against an NI rating (Phase S renders it). */
  notInspectedReason?: string | null;
  notes: string | null;
  photos: ReportPhoto[];
  recommendation?: string | null;
  estimateMin?: number | null;
  estimateMax?: number | null;
  /** Task 8 — attached repair items snapshotted on this finding (dollars). */
  repairItems?: {
    summary: string;
    estimateMin: number | null;
    estimateMax: number | null;
    contractorType: string | null;
  }[];
  value?: unknown;
  unit?: string | null;
  /** FE-3/B-20 — resolved canned + custom defects (server emits both). */
  resolvedTabs?: {
    defects?: ResolvedDefect[];
  };
}

export interface ReportSection {
  id: string;
  title: string;
  icon?: string | null;
  defectCount: number;
  items: ReportItem[];
  disclaimerText?: string | null;
  alwaysPageBreak?: boolean;
}

export type FilterKey = "all" | "defects" | "summary";

/* ------------------------------------------------------------------ */
/* Print layout constants (exported for tests + re-exported via the    */
/* standalone route). PRINT-ONLY — on-screen rendering is unchanged.   */
/* ------------------------------------------------------------------ */

/** Inspection-item / defect / stats cards: never split a card across pages. */
export const PRINT_CARD_CLASS = "print:break-inside-avoid";
/** Photo cells: never split a photo across a page boundary. */
export const PRINT_FIGURE_CLASS = "print:break-inside-avoid";
/** Section headings: keep a heading glued to the content that follows. */
export const PRINT_SECTION_HEADING_CLASS = "print:break-after-avoid";
/** Defect photo grid (screen 3/4-col) collapses to a dense 3-col in print. */
export const DEFECT_PHOTO_GRID_CLASS =
  "grid grid-cols-3 sm:grid-cols-4 print:grid-cols-3 gap-1.5";
/** Item photo grid (screen 2/3-col) collapses to a dense 3-col in print. */
export const ITEM_PHOTO_GRID_CLASS =
  "grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-2";
/** CF Images thumbnail width: smaller in print to keep the PDF lean. */
export const printThumbWidth = (isPrint: boolean): number => (isPrint ? 480 : 800);

export interface ReportSignature {
  signatureBase64: string | null;
  signedAt: number | null; // epoch ms
  inspectorName: string;
  inspectorLicense: string | null;
}

/* Commercial PCA Phase S — report-skeleton types re-declared across the
   server/app boundary (app/ cannot import server/lib/). Shapes mirror
   server/lib/pca-section-registry.ts, pca-narrative.ts, pca-systems-summary.ts,
   pca-deviations.ts exactly. */
export interface PcaSectionEntry {
  id: string;
  level: number;
  title: string;
  tiers: ('light' | 'full')[];
}
export interface PcaNarrativeData {
  transmittalLetter: string;
  summaryGeneralDescription: string;
  summaryPhysicalCondition: string;
  summaryRecommendations: string;
  purpose: string;
  scopeOfWork: string;
  limitationsExceptions: string;
  reconnaissance: string;
  additionalConsiderations: string;
}
export interface SystemsSummaryRow {
  systemId: string;
  systemTitle: string;
  worstSeverity: 'good' | 'marginal' | 'significant' | 'minor';
  counts: { safety: number; recommendation: number; maintenance: number };
}
export interface Deviation {
  id: string;
  area: string;
  baselineRequirement: string;
  deviation: string;
  reason: string;
}
export interface PcaReportData {
  sectionRegistry: PcaSectionEntry[];
  narrative: PcaNarrativeData;
  systemsSummary: SystemsSummaryRow[];
  deviations: Deviation[];
}

export interface ReportVerification {
  versionNumber: number;
  contentHash: string;
  verifyToken: string;
  publishedAt: number; // unix seconds
}

/* Commercial PCA Phase U — per-unit matrix types re-declared across the
   server/app boundary (app/ cannot import server/lib/). Shapes mirror
   server/lib/unit-scope.ts exactly (same precedent as the Phase S types above). */
export type Severity = 'good' | 'marginal' | 'significant' | 'minor';
interface MatrixCell {
  worst: Severity | null;
  counts: { safety: number; recommendation: number; maintenance: number };
}
export interface UnitMatrixRow {
  unitId: string;
  label: string;
  cells: Record<string, MatrixCell>;
  isException: boolean;
}
interface ReportUnit {
  id: string;
  label: string;
  kind: string;
  type: string;
  parentUnitId: string | null;
  sortOrder: number;
  attrs: unknown;
}

/**
 * The report loader payload shape. Kept here (exported) so both the standalone
 * route and the portal route can type their loaders against it and feed it to
 * `reportViewProps()`.
 */
export interface ReportLoaderResult {
  inspectionId: string;
  address: string;
  date: string;
  inspectorName: string | null;
  coverPhotoUrl: string | null;
  stats: { total: number; satisfactory: number; monitor: number; defect: number };
  sections: ReportSection[];
  showEstimates: boolean;
  enableRepairList: boolean;
  enableCustomerRepairExport: boolean;
  isDelivered: boolean;
  brand: TenantBrand;
  error: string | null;
  notPublished: boolean;
  reportTheme?: string;
  initialFilter: FilterKey;
  printMode: boolean;
  isPublished: boolean;
  signature: ReportSignature | null;
  verification: ReportVerification | null;
  ownerPreview: boolean;
  baseUrl: string;
  propertyType: string | null;
  commercialSubtype: string | null;
  buildingProfile: ProfileRow[];
  pcaReport: PcaReportData | null;
  /* Commercial PCA Phase U — per-unit inspection mode + the unit tree,
     units×systems condition matrix, and per-unit defect counts. Matrix + counts
     are empty in 'tagged' mode so non-per_unit reports render byte-identically. */
  unitInspectionMode: 'tagged' | 'per_unit';
  units: ReportUnit[];
  unitConditionMatrix: UnitMatrixRow[];
  defectCountsByUnit: Record<string, number>;
}
