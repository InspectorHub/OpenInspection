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

/** Plan 7 — a report photo object may carry a resolved media kind (video).
 *  Commercial PCA Phase P — `photoNo` is the render-order stamp assigned
 *  server-side (Appendix B back-references + inline numbering); absent when
 *  the server hasn't assigned one yet. */
export type ReportPhoto = { key: string; url: string; media?: ReportMedia; photoNo?: number };

/** Commercial PCA Phase P — whether report photos render inline (per-item,
 *  legacy behavior) or are collected into a numbered Appendix B (server
 *  resolves this from report_tier + the per-inspection override; app/ cannot
 *  import server/lib/report-photo-mode, so it's re-declared here). */
type PhotoMode = "appendix" | "inline";

/** Commercial PCA Phase P — a single Appendix B entry (server produces these
 *  in render order; app/ cannot import server/lib/pca-photo-appendix). */
export interface AppendixPhoto {
  photoNo: number;
  key: string;
  url: string;
  caption: string | null;
  sectionId: string;
  sectionTitle: string;
  itemId: string;
  itemLabel: string;
}

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

/** Commercial PCA Phase T — the resolved report tier (server produces this;
 *  app/ cannot import server/lib/report-tier, so it's re-declared here). */
type ReportTier = 'light_commercial' | 'full_pca';

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

/* Commercial PCA Phase O — TOC projection re-declared across the server/app
   boundary (app/ cannot import server/lib/report-outline.ts). Shape mirrors
   server/lib/report-outline.ts's ReportOutlineEntry exactly. */
export interface ReportOutlineEntry {
  id: string;
  level: number;
  title: string;
  /** Filled by the PDF measurement pass; undefined/null on the web. */
  page?: number | null;
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

/* Commercial PCA Phase M — compliance-record view types re-declared across the
   server/app boundary (app/ cannot import server/lib/). Shapes mirror the M7
   compliance payload (ASTM conformance flag, dual-role signoffs, PSQ,
   document-review checklist, reliance language) exactly. */
export interface AstmConformance { standard: 'E2018-24'; conforms: boolean }
export interface ReportSignoffView {
  role: 'field_observer' | 'pcr_reviewer';
  name: string; license: string | null; qualificationsRef: string | null;
  signedAt: number; dualRole: boolean;
}
export interface PsqView { status: 'sent' | 'received' | 'declined'; responses: Record<string, unknown> | null }
export interface DocReviewView {
  documentKey: string; label: string;
  requested: boolean; received: boolean; reviewed: boolean; na: boolean; notes: string | null;
}
export interface RelianceText { userReliance: string; pointInTime: string; siteSpecific: string }

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

/* Commercial PCA Phase C — client-side mirror of server/lib/pca-costs shapes
   (server lib cannot be imported by app/; these are structural duplicates). */
export interface CostItemView {
  id: string; system: string; component: string; location: string;
  action: 'repair' | 'replace' | 'further_study';
  costMethod: 'unit' | 'lump_sum';
  quantity: number | null; uom: string | null;
  unitCostCents: number | null; lumpSumCents: number | null;
  eul: number | null; effAge: number | null; rul: number | null;
  suggestedRemedy: string;
  bucket: 'immediate' | 'short_term' | 'long_term';
  sectionRef: string | null; photoRef: string | null; sortOrder: number;
}
export interface Table1Row { item: CostItemView; total: number }
export interface Table1 {
  immediate: Table1Row[]; shortTerm: Table1Row[];
  immediateTotalCents: number; shortTermTotalCents: number;
}
export interface ReserveRow {
  item: CostItemView; placementYear: number; replacementCents: number;
  /** Commercial PCA Phase P/C seam — resolved appendix photo number for
   *  `item.photoRef` (server resolves via buildPhotoRefIndex/resolvePhotoRef).
   *  Optional/absent when the producer skipped resolution; null when the ref
   *  didn't resolve; the PHOTO NO. cell renders nothing in either case. */
  photoNo?: number | null;
}
export interface ReserveSchedule {
  startYear: number; termYears: number; years: number[]; rows: ReserveRow[];
  uninflatedByYear: number[]; inflatedByYear: number[]; cumulativeInflatedByYear: number[];
  totalUninflatedCents: number; totalInflatedCents: number;
  perSfUninflatedAllYears: number | null; perSfInflatedAllYears: number | null; perSfInflatedPerYear: number | null;
}
export interface BucketRollup { immediateCents: number; shortTermCents: number; reserveCents: number }
export interface CostTables {
  table1: Table1; reserveSchedule: ReserveSchedule | null;
  rollup: BucketRollup; droppedCount: number;
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
  costTables: CostTables | null;
  enableRepairList: boolean;
  enableCustomerRepairExport: boolean;
  isDelivered: boolean;
  brand: TenantBrand;
  error: string | null;
  notPublished: boolean;
  reportTheme?: string;
  initialFilter: FilterKey;
  printMode: boolean;
  /* Commercial PCA Task 19a — real TOC page numbers, two-pass Chrome + pdf-lib.
     Parsed from the `?tocpages=<base64url(JSON)>` param that `generatePdfWithTocPages`
     appends to the pass-2 render URL (server/lib/pdf.ts): `extractAnchorPages`
     (server/lib/toc-pages.ts) reads the named PDF destinations Chrome emits for
     each pass-1 `<a href="#id">` TOC link and resolves them to 1-based page
     numbers. Undefined on the web and on pass 1 of the PDF render — `<ReportToc>`
     renders its reserved page-ref slot empty in either case, so the report is
     byte-identical apart from the filled-in numbers on pass 2. */
  tocPages?: Record<string, number>;
  isPublished: boolean;
  signature: ReportSignature | null;
  verification: ReportVerification | null;
  /* Commercial PCA Phase M — compliance record surfaces (ASTM conformance
     statement, dual-role signoffs, PSQ status, document-review checklist,
     reliance language). Empty/null-safe in every fallback path. */
  astmConformance: AstmConformance | null;
  reportSignoffs: ReportSignoffView[];
  psq: PsqView | null;
  documentReview: DocReviewView[];
  relianceText: RelianceText;
  ownerPreview: boolean;
  baseUrl: string;
  /* Commercial PCA Phase P — photo rendering mode (inline vs. numbered
     Appendix B) and the resolved appendix entries. Empty/'inline' in every
     fallback path so non-appendix reports render byte-identically. */
  photoMode: PhotoMode;
  photoAppendix: AppendixPhoto[];
  propertyType: string | null;
  commercialSubtype: string | null;
  reportTier: ReportTier | null;
  buildingProfile: ProfileRow[];
  pcaReport: PcaReportData | null;
  /* Commercial PCA Phase U — per-unit inspection mode + the unit tree,
     units×systems condition matrix, and per-unit defect counts. Matrix + counts
     are empty in 'tagged' mode so non-per_unit reports render byte-identically. */
  unitInspectionMode: 'tagged' | 'per_unit';
  units: ReportUnit[];
  unitConditionMatrix: UnitMatrixRow[];
  defectCountsByUnit: Record<string, number>;
  /* Commercial PCA Phase O — the TOC projection over the tier-gated section
     registry. Empty for residential/no-tier reports (no PCA front matter to
     project a TOC over). */
  outline: ReportOutlineEntry[];
}
