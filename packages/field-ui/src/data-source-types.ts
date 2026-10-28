/**
 * Data types of the `FieldDataSource` contract.
 *
 * The package may not import from `app/` or `server/` (see
 * `scripts/check-field-ui-boundary.mjs`). Types that live in `./shared` are
 * re-exported from there, so the contract and the editor logic share one
 * definition. The shapes the editor reads that still live in the host
 * (`packages/field-ui/src/hooks/useInspection.ts`, the inspection-edit loader, server libraries)
 * are declared here from what `app/routes/inspection-edit/loader.server.ts`
 * returns and what `app/routes/inspection-edit.tsx` reads off it.
 */

import type { Snapshot } from './shared/structure-ops';
import type { PropertyMetaField } from './shared/commercial-subtypes';
import type { PcaNarrative } from './shared/pca-narrative';
import type { AutoAdvanceMode } from './shared/rating-levels';

export type { PropertyMetaField, PcaNarrative, AutoAdvanceMode };
export type * from './resource-types';

/** Mirrors `Inspection` in packages/field-ui/src/hooks/useInspection.ts. */
export interface EditorInspection {
  id: string;
  propertyAddress?: string;
  clientName?: string;
  clientEmail?: string;
  date?: string;
  scheduledDate?: string;
  createdAt?: string;
  status?: string;
  reportStatus?: string;
  propertyType?: string;
  teamMode?: boolean;
  paymentRequired?: boolean;
  agreementRequired?: boolean;
  /** The loader deletes this from the row and returns it once, top-level. */
  templateSnapshot?: unknown;
  /** The loader row is the full inspection record; the editor reads further keys defensively. */
  [key: string]: unknown;
}

/** Mirrors `RatingLevel` in packages/field-ui/src/hooks/useInspection.ts. */
export interface RatingLevel {
  id: string;
  label: string;
  name?: string;
  abbreviation?: string;
  color: string;
  severity?: string;
  isDefect?: boolean;
  description?: string;
  pausesAdvance?: boolean;
}

/**
 * Item bodies carry canned-comment tabs, attributes, options and more; the
 * editor reads them through narrower local types.
 */
export type TemplateItemBody = Record<string, unknown>;

/** Mirrors `SchemaItem` in packages/field-ui/src/hooks/useInspection.ts. */
export interface SchemaItem extends TemplateItemBody {
  id: string;
  label: string;
  name?: string;
  type: string;
}

/** Mirrors `SchemaSection` in packages/field-ui/src/hooks/useInspection.ts. */
export interface SchemaSection {
  id: string;
  title: string;
  name?: string;
  icon?: string;
  items: SchemaItem[];
}

/** The schema after the loader overlays report-data sections. */
export interface TemplateSchema {
  sections: SchemaSection[];
}

/** Mirrors `ResultMap` in packages/field-ui/src/hooks/useInspection.ts. */
export type ResultMap = Record<string, Record<string, unknown>>;

/** Mirrors `TagPin` in packages/field-ui/src/components/editor/TagChipRow.tsx. */
export interface TagLibraryEntry {
  id: string;
  name: string;
  color: string;
}

/** The tags on each checklist item of one inspection, keyed by the item's id (the editor's chips). */
export type ItemTagMap = Record<string, Array<{ id: string; name: string; color?: string }>>;

/** The loader returns `{ id, name, color }` rows. */
export interface DefectCategory {
  id: string;
  name: string;
  color: string;
}

/** Mirrors `UnitScopeRow` in packages/field-ui/src/components/editor/BreadcrumbDropdown.tsx. */
export interface InspectionUnit {
  id: string;
  name: string;
  /** 'building' | 'floor' | 'unit'. */
  kind: string;
  /** 'unit' | 'common'. */
  type: string;
  parentUnitId: string | null;
  sortOrder: number;
}

export interface UnitProgress {
  units: Array<{ unitId: string; rated: number; total: number }>;
  commonRated: number;
  total: number;
}

/**
 * The raw, un-normalised template snapshot structural operations rebuild from.
 * This is the `Snapshot` the structural operations in `./shared/structure-ops`
 * take and return, so a snapshot read from the data source feeds them directly.
 */
export type TemplateSnapshot = Snapshot;

/**
 * Source today: `RevisionStatus` in server/lib/statutory/revision-status.ts, which
 * is NOT moved into the package (it pulls in pdf-lib). The data source computes
 * it, so this declaration is the package's own contract.
 */
export type RevisionStatus =
  | { kind: 'current' }
  | { kind: 'superseding_soon'; nextVersion: string; from: number }
  | { kind: 'superseded_elsewhere'; nextVersion: string; from: number }
  | { kind: 'cannot_produce'; applicableVersion: string; templateVersion: string }
  | {
      kind: 'withdrawn';
      version: string;
      /** The server's `WithdrawalReason` union. */
      reason: string;
      withdrawnAt: number;
      replacementVersion: string | null;
    };

/** Mirrors the local `StatutoryDetails` in loader.server.ts. */
export interface StatutoryDetails {
  inspectorSignatureDate: string | null;
  employeePrintedName: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerMailingAddress: string | null;
  ownerHomePhone: string | null;
  ownerWorkPhone: string | null;
  ownerCellPhone: string | null;
}

/** Mirrors the local `StatutoryCoverage` in loader.server.ts. */
export interface StatutoryCoverage {
  formId: string;
  formTitle: string;
  revision: string | null;
  requiredTotal: number;
  missing: Array<{ field: string; provenance: 'pre_inspection' | 'per_inspection' | 'unknown' }>;
}

export interface ReportSignoffView {
  role: 'field_observer' | 'pcr_reviewer';
  personId: string;
  name: string;
  license: string | null;
  qualificationsRef?: string | null;
  signedAt?: number;
  dualRole?: boolean;
}

export interface PsqView {
  status: 'sent' | 'received' | 'declined';
  responses: Record<string, unknown> | null;
}

export interface DocumentReviewItemView {
  documentKey: string;
  label: string;
  requested: boolean;
  received: boolean;
  reviewed: boolean;
  na: boolean;
  notes: string | null;
}

export interface RelianceText {
  userReliance: string;
  pointInTime: string;
  siteSpecific: string;
}

/** What the compliance panel renders. The compliance panel and the editor loader share it. */
export interface CompliancePanelData {
  reportSignoffs: ReportSignoffView[];
  psq: PsqView | null;
  documentReview: DocumentReviewItemView[];
  conformance: { standard: 'E2018-24'; conforms: boolean };
  relianceText: RelianceText;
}

/** The loader returns the `commercial:<subtype>`-keyed subset of METADATA_PRESETS. */
export type CommercialPresets = Record<string, PropertyMetaField[]>;

/** Mirrors `ReportLinkTtl` in server/lib/report-link-ttl.ts (server code, not importable here). */
export type ReportLinkTtl = 'never' | { count: number; unit: 'days' | 'months' | 'years' };

/**
 * The tenant's inspection-editor preferences, as `useInspectionPrefs` reads and
 * patches them (packages/field-ui/src/hooks/useInspectionPrefs.ts, `InspectionPrefs`).
 */
export interface InspectionPrefs {
  cloneDefault: 'rating' | 'rating_notes' | 'all';
  autoAdvance: AutoAdvanceMode;
  autoAdvanceDelayMs: number;
  pinnedTagIds: string[];
  /** Which defect fields the publish gate requires tenant-wide. */
  requireDefectFields: 'none' | 'location' | 'trade' | 'both';
  agentRepairAccess: 'off' | 'read' | 'readwrite';
  reportLinkTtl: ReportLinkTtl;
}

/**
 * A crop rectangle in source-image pixels, as the editor serialises it to the
 * crop endpoints (usePhotoOps `cropTransform`: `{ aspect, orientation, ...pixels }`).
 */
export interface PhotoCropTransform {
  /** 'free' or a preset such as '3:2'. */
  aspect: string;
  orientation: 'landscape' | 'portrait';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cooling-window signal the publish dialog reads. */
export interface OutboundCoolingWindow {
  unlockAtMs: number;
  turnstileSiteKey: string | null;
}

/** The Appendix narrative blocks of a commercial (PCA) report; same shape as `PcaNarrative`. */
export type PcaNarrativeData = PcaNarrative;

/**
 * One cost line of a commercial report, client-side mirror of the server's
 * pca-costs shape (server code is not importable here).
 */
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

/** One template row of the template picker. Mirrors the rows `/resources/template-search` returns. */
export interface TemplateSummary {
  id: string;
  name: string;
}

/**
 * One page of the template picker's search. Mirrors the loader of
 * `app/routes/resources/template-search.tsx`. The host pages by page number
 * (25 rows per page), not by offset, so the contract does too.
 */
export interface TemplateSearchResult {
  templates: TemplateSummary[];
  hasMore: boolean;
  page: number;
  totalPages: number;
}

/**
 * The filters of a canned-comment library read. Every member is optional and an absent or
 * empty one is not sent. The host serialises the members in their insertion order, so a
 * caller that sets `sort` before `search` sends them in that order.
 */
export interface CommentsLibraryQuery {
  search?: string;
  /** 'relevance' or a host-defined sort name. */
  sort?: string;
  /** 'auto' narrows by the item context below; 'all' ignores it. */
  filterMode?: string;
  itemLabel?: string;
  section?: string;
  severity?: string;
  pageSize?: string;
}

/** One library row as the host answers it. `lastUsedAt` is present when the host tracks use. */
export interface CommentsLibraryRow {
  id: string;
  text: string;
  category: string | null;
  severity: string | null;
  section: string | null;
  libraryId?: string | null;
  useCount?: number;
  lastUsedAt?: string | null;
}

/**
 * What a library save or edit carries. An empty string for `section`, `category` or `itemLabel`
 * means "none". `severity` is a rating severity or 'all'; the host stores anything else as none.
 */
export interface CommentsLibraryEntry {
  text: string;
  severity: string;
  section: string;
  category: string;
  itemLabel: string;
  repairSummary?: string;
  recommendedContractorTypeId?: string;
}

/**
 * One AI writing-assistance request. `assist` asks for a rewrite of `text` (with the item
 * `context` when there is one); `review` records that a person reviewed the output of call
 * `aiCallId` for the artifact `artifactId`.
 */
export type AiAssistInput =
  | { intent: 'assist'; payload: { text: string; context?: string } }
  | { intent: 'review'; payload: { artifactId: string; aiCallId: string } };

/**
 * What an AI assist or review answers. A successful `assist` carries BOTH the text and the id of the
 * call that produced it (a suggestion without an id could never be reviewed, so a host answers
 * `ok: false` instead); a successful `review` carries neither. `error` is the sentence to show.
 */
export type AiAssistResult =
  | { ok: true; intent: 'assist'; text: string; aiCallId: string }
  | { ok: true; intent: 'review' }
  | { ok: false; error: string };
