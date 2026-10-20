import type * as Y from 'yjs';
import type {
  CommercialPresets,
  CompliancePanelData,
  DefectCategory,
  EditorInspection,
  InspectionUnit,
  OutboundCoolingWindow,
  PcaNarrative,
  RatingLevel,
  ResultMap,
  RevisionStatus,
  StatutoryCoverage,
  StatutoryDetails,
  TagLibraryEntry,
  TemplateSchema,
  TemplateSnapshot,
  UnitProgress,
  RelianceText,
} from './data-source-types';

/** Everything the editor reads on open. Mirrors the inspection-edit loader's return value. */
export interface EditorData {
  inspection: EditorInspection;
  /** The schema with report-data sections overlaid. Never PATCH this; use `templateSnapshot`. */
  schema: TemplateSchema;
  results: ResultMap;
  ratingLevels: RatingLevel[];
  tagLibrary: TagLibraryEntry[];
  defectCategories: DefectCategory[];
  units: InspectionUnit[];
  unitProgress: UnitProgress;
  /** 'tagged' is the loader's default; 'per_unit' loads findings per scope. */
  unitInspectionMode: 'tagged' | 'per_unit';
  templateSnapshot: TemplateSnapshot | null;
  /** Computed by the data source; the package never imports revision-status (it pulls in pdf-lib). */
  revisionStatus: RevisionStatus | null;
  statutoryDetails: StatutoryDetails | null;
  statutoryCoverage: StatutoryCoverage | null;
  compliance: Omit<CompliancePanelData, 'relianceText'> | null;
  pcaNarrative: PcaNarrative | null;
  relianceText: RelianceText | null;
  commercialPresets: CommercialPresets;
  nextPublishIsAmendment: boolean;
  outboundCoolingWindow: OutboundCoolingWindow | null;
  resultId: string | null;
}

export interface SessionInfo {
  tenantSlug: string | null;
  videoProvider: 'stream' | 'r2' | null;
  streamCustomerSubdomain: string | null;
  collabEditing: boolean;
  /** Replaces the editor's hard-coded presence user id. */
  userId: string;
  role: string;
}

/** The write commands the editor issues. One member per route-action intent the editor uses. */
export type FieldCommand =
  | { type: 'complete' }
  | { type: 'publish'; autoSignOnPublish: boolean; markComplete: boolean; summary?: string }
  | { type: 'save-property-facts'; payload: Record<string, unknown> }
  | { type: 'autofill-property-facts'; addressString: string }
  | { type: 'save-settings'; payload: Record<string, unknown> }
  | { type: 'save-pca-narrative'; key: string; value: string }
  | { type: 'sign-inspector'; signatureBase64: string }
  | { type: 'set-cover'; coverPhotoId: string }
  | { type: 'upload-cover'; file: Blob }
  | { type: 'crop-cover'; sourceKey: string; crop: unknown; image: Blob }
  | { type: 'annotate'; itemId: string; photoIndex: number; nodes: unknown; sectionId: string; image: Blob }
  | { type: 'restructure'; snapshot: TemplateSnapshot; collab: boolean }
  | { type: 'save-structure-template'; mode: 'new' | 'back'; snapshot: TemplateSnapshot; name?: string; templateId?: string }
  | { type: 'add-statutory-instance'; groupId: string; index: number; fields: Record<string, unknown> }
  | { type: 'save-statutory-details'; payload: Record<string, unknown> }
  | { type: 'set-followup'; itemId: string; status: string | null; notes?: string }
  | { type: 'unit'; op: 'create' | 'rename' | 'delete' | 'duplicate' | 'bulk-create' | 'mode-switch'; payload: Record<string, unknown> }
  | { type: 'compliance'; op: 'signoff' | 'remove-signoff' | 'doc-review-seed' | 'doc-review' | 'psq' | 'psq-status'; payload: Record<string, unknown> }
  | { type: 'load-scope'; scope: string };

export interface CommandResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export interface PendingMediaRecord {
  pendingId: string;
  inspectionId: string;
  kind: 'photo' | 'crop' | 'annotate';
  blob: Blob;
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface PendingMediaStore {
  /** Must reject on failure. */
  put(rec: PendingMediaRecord): Promise<void>;
  get(pendingId: string): Promise<PendingMediaRecord | null>;
  list(inspectionId?: string): Promise<PendingMediaRecord[]>;
  delete(pendingId: string): Promise<void>;
  /** Web: URL.createObjectURL; app: Capacitor.convertFileSrc. */
  objectUrl(pendingId: string): Promise<string | null>;
}

export interface MediaUploader {
  upload(rec: PendingMediaRecord): Promise<{ ok: true; key: string; result?: unknown } | { ok: false; error: string }>;
}

export interface ResultsDocHandle {
  doc: Y.Doc;
  persistenceSynced: Promise<void>;
  synced: () => boolean;
  destroy(): void;
}

export interface CollabConnector {
  /** Open a results document: local persistence first, then the network. */
  connect(inspectionId: string, opts: { onChange?: () => void; onSynced?: () => void }): ResultsDocHandle;
  purge(inspectionId: string): Promise<void>;
}

export interface FieldUrls {
  photo(inspectionId: string, key: string): string;
  reportPreview(tenantSlug: string, inspectionId: string): string | null;
  reportPdf(inspectionId: string): string | null;
  statutoryPreviewPdf(inspectionId: string): string | null;
  videoObject(inspectionId: string, ref: string): string | null;
}

/**
 * Optional host capabilities. An absent member hides its entry point.
 * The `unknown` payloads are tightened by plan B Task 8, which gives each
 * capability the concrete shape its panel reads.
 */
export interface FieldResources {
  commentsLibrary?: { list(): Promise<unknown>; save(entry: unknown): Promise<CommandResult>; remove(id: string): Promise<CommandResult> };
  costItems?: { list(inspectionId: string): Promise<unknown>; save(payload: unknown): Promise<CommandResult> };
  repairItems?: { list(inspectionId: string): Promise<unknown> };
  mediaPool?: { list(inspectionId: string): Promise<unknown> };
  settingsSheet?: { load(inspectionId: string): Promise<unknown> };
  aiAssist?: { run(input: { intent: 'assist' | 'review'; payload: unknown }): Promise<CommandResult> };
  publishReadiness?: { check(inspectionId: string): Promise<unknown> };
  versionHistory?: {
    list(inspectionId: string): Promise<unknown>;
    get(inspectionId: string, seq: number): Promise<unknown>;
    restore(inspectionId: string, seq: number): Promise<CommandResult>;
  };
  video?: {
    createUpload(inspectionId: string): Promise<unknown>;
    uploadPoster(inspectionId: string, blob: Blob): Promise<CommandResult>;
    finalize(inspectionId: string, payload: unknown): Promise<CommandResult>;
    remove(inspectionId: string, ref: string): Promise<CommandResult>;
  };
}

export interface FieldDataSource {
  load(inspectionId: string, scope?: string): Promise<EditorData>;
  session(): SessionInfo;
  execute(inspectionId: string, cmd: FieldCommand): Promise<CommandResult>;
  reload(): void;
  exit(): void;
  isOnline(): boolean;
  onOnlineChange(cb: (online: boolean) => void): () => void;
  collab: CollabConnector;
  media: { store: PendingMediaStore; uploader(inspectionId: string): MediaUploader };
  urls: FieldUrls;
  resources: FieldResources;
  platform: 'web' | 'ios' | 'android';
}
