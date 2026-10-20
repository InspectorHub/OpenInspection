/**
 * Structural data types of the `FieldDataSource` contract.
 *
 * The package may not import from `app/` or `server/` (see
 * `scripts/check-field-ui-boundary.mjs`), so the shapes the editor reads are
 * declared here, field by field, from what `app/routes/inspection-edit/loader.server.ts`
 * returns and what `app/routes/inspection-edit.tsx` reads off it.
 *
 * Each type below is a TEMPORARY duplicate of an existing definition. When the
 * owning implementation file moves into the package (plan B, Task 3 for pure
 * logic, Task 5 for components), the moved file becomes the single source and
 * the matching declaration here is deleted. The owner is named per type.
 *
 * Where a deep structure is not pinned down yet, the member is typed with a
 * named `unknown` alias (never `any`) that the named later task tightens.
 */

/** Source today: `Inspection` in app/hooks/useInspection.ts. Replaced by Task 3. */
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

/** Source today: `RatingLevel` in app/hooks/useInspection.ts. Replaced by Task 3. */
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
 * editor reads them through narrower local types today. Task 3 replaces this
 * alias with the canonical item type moved from server/types/template-schema.ts.
 */
export type TemplateItemBody = Record<string, unknown>;

/** Source today: `SchemaItem` in app/hooks/useInspection.ts. Replaced by Task 3. */
export interface SchemaItem extends TemplateItemBody {
  id: string;
  label: string;
  name?: string;
  type: string;
}

/** Source today: `SchemaSection` in app/hooks/useInspection.ts. Replaced by Task 3. */
export interface SchemaSection {
  id: string;
  title: string;
  name?: string;
  icon?: string;
  items: SchemaItem[];
}

/** The schema after the loader overlays report-data sections. Replaced by Task 3. */
export interface TemplateSchema {
  sections: SchemaSection[];
}

/** Source today: `ResultMap` in app/hooks/useInspection.ts. Replaced by Task 3. */
export type ResultMap = Record<string, Record<string, unknown>>;

/** Source today: `TagPin` in app/components/editor/TagChipRow.tsx. Replaced by Task 5. */
export interface TagLibraryEntry {
  id: string;
  name: string;
  color: string;
}

/** The loader returns `{ id, name, color }` rows. Replaced by Task 5 if a component type is moved. */
export interface DefectCategory {
  id: string;
  name: string;
  color: string;
}

/** Source today: `UnitScopeRow` in app/components/editor/BreadcrumbDropdown.tsx. Replaced by Task 5. */
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
 * Sections stay opaque: the editor hands them back to the data source unchanged.
 * Task 3 narrows `sections` to the canonical `TemplateSection[]`.
 */
export interface TemplateSnapshot {
  schemaVersion: 2;
  sections: unknown[];
  [key: string]: unknown;
}

/**
 * Source today: `RevisionStatus` in server/lib/statutory/revision-status.ts, which
 * is NOT moved into the package (it pulls in pdf-lib). The data source computes
 * it, so this declaration stays the package's own contract; a drift test against
 * the server union belongs to Task 3.
 */
export type RevisionStatus =
  | { kind: 'current' }
  | { kind: 'superseding_soon'; nextVersion: string; from: number }
  | { kind: 'superseded_elsewhere'; nextVersion: string; from: number }
  | { kind: 'cannot_produce'; applicableVersion: string; templateVersion: string }
  | {
      kind: 'withdrawn';
      version: string;
      /** The server's `WithdrawalReason` union; tightened by the Task 3 drift test. */
      reason: string;
      withdrawnAt: number;
      replacementVersion: string | null;
    };

/** Source today: the local `StatutoryDetails` in loader.server.ts. Replaced by Task 5. */
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

/** Source today: the local `StatutoryCoverage` in loader.server.ts. Replaced by Task 5. */
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

/** Source today: `CompliancePanelData` in app/components/inspection-edit/CompliancePanel.tsx. Replaced by Task 5. */
export interface CompliancePanelData {
  reportSignoffs: ReportSignoffView[];
  psq: PsqView | null;
  documentReview: DocumentReviewItemView[];
  conformance: { standard: 'E2018-24'; conforms: boolean };
  relianceText: RelianceText;
}

/** Source today: `PcaNarrative` in server/lib/pca-narrative.ts. Replaced by Task 3. */
export interface PcaNarrative {
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

/** Source today: `PropertyMetaField` in server/lib/commercial-subtypes.ts. Replaced by Task 3. */
export interface PropertyMetaField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'date';
  group?: string;
  required?: boolean;
  unit?: string;
  options?: string[];
}

/** The loader returns the `commercial:<subtype>`-keyed subset of METADATA_PRESETS. */
export type CommercialPresets = Record<string, PropertyMetaField[]>;

/** The cooling-window signal the publish dialog reads. */
export interface OutboundCoolingWindow {
  unlockAtMs: number;
  turnstileSiteKey: string | null;
}
