/**
 * Data types of the `FieldDataSource` contract.
 *
 * The package may not import from `app/` or `server/` (see
 * `scripts/check-field-ui-boundary.mjs`). Types that live in `./shared` are
 * re-exported from there, so the contract and the editor logic share one
 * definition. The shapes the editor reads that still live in the host
 * (`app/hooks/useInspection.ts`, the inspection-edit loader, server libraries)
 * are declared here from what `app/routes/inspection-edit/loader.server.ts`
 * returns and what `app/routes/inspection-edit.tsx` reads off it.
 */

import type { Snapshot } from './shared/structure-ops';
import type { PropertyMetaField } from './shared/commercial-subtypes';
import type { PcaNarrative } from './shared/pca-narrative';
import type { AutoAdvanceMode } from './shared/rating-levels';

export type { PropertyMetaField, PcaNarrative, AutoAdvanceMode };

/** Mirrors `Inspection` in app/hooks/useInspection.ts. */
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

/** Mirrors `RatingLevel` in app/hooks/useInspection.ts. */
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

/** Mirrors `SchemaItem` in app/hooks/useInspection.ts. */
export interface SchemaItem extends TemplateItemBody {
  id: string;
  label: string;
  name?: string;
  type: string;
}

/** Mirrors `SchemaSection` in app/hooks/useInspection.ts. */
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

/** Mirrors `ResultMap` in app/hooks/useInspection.ts. */
export type ResultMap = Record<string, Record<string, unknown>>;

/** Mirrors `TagPin` in app/components/editor/TagChipRow.tsx. */
export interface TagLibraryEntry {
  id: string;
  name: string;
  color: string;
}

/** The loader returns `{ id, name, color }` rows. */
export interface DefectCategory {
  id: string;
  name: string;
  color: string;
}

/** Mirrors `UnitScopeRow` in app/components/editor/BreadcrumbDropdown.tsx. */
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

/** Mirrors `CompliancePanelData` in app/components/inspection-edit/CompliancePanel.tsx. */
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
 * patches them (app/hooks/useInspectionPrefs.ts, `InspectionPrefs`).
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
