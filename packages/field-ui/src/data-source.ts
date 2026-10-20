import type * as Y from 'yjs';
import type { CommandData, CommandResult, FieldCommand } from './commands';
import type { PendingMediaStore, MediaUploader } from './media-types';
import type {
  CommercialPresets,
  CompliancePanelData,
  DefectCategory,
  EditorInspection,
  InspectionPrefs,
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
  /**
   * Always an object. The data source supplies the loader's default shape
   * (`{ schemaVersion: 2, sections: [] }`) when the inspection has no snapshot
   * (loader.server.ts, the `templateSnapshot` const).
   */
  templateSnapshot: TemplateSnapshot;
  /**
   * Null for every inspection whose template declares no statutory form, or names
   * no revision (`revisionStatusForInspection` returns null). Computed by the data
   * source; the package never imports revision-status (it pulls in pdf-lib).
   */
  revisionStatus: RevisionStatus | null;
  /** Null when the template declares no statutory form, or the read failed (loader: `statutoryDetails`). */
  statutoryDetails: StatutoryDetails | null;
  /**
   * Null means "could not be answered", NOT "nothing is missing" (loader:
   * `statutoryCoverage`). An empty `missing` array is the other thing.
   */
  statutoryCoverage: StatutoryCoverage | null;
  /**
   * Always an object: the data source supplies the loader's default shape (empty
   * sign-offs and checklist, `psq: null`, `conforms: false`) when the inspection
   * has no compliance rows or the read failed. The route merges
   * `{ ...compliance, relianceText }`, so a null here would reach the panel as undefined.
   */
  compliance: Omit<CompliancePanelData, 'relianceText'>;
  /** Always an object: the seed-resolved narrative (`resolvePcaNarrative`); the data source supplies the seed. */
  pcaNarrative: PcaNarrative;
  /** Always an object: stored text, falling back to the standard boilerplate per field; the data source supplies it. */
  relianceText: RelianceText;
  commercialPresets: CommercialPresets;
  nextPublishIsAmendment: boolean;
  /** Null unless the session context reports a cooling window. */
  outboundCoolingWindow: OutboundCoolingWindow | null;
  /** Null on legacy inspections created before every inspection got a results row. */
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

export type {
  AutofillReason,
  BulkCreateUnitsBody,
  CommandData,
  CommandDataMap,
  CommandKey,
  CommandResult,
  ComplianceCommand,
  FieldCommand,
  SaveStructureTemplateCommand,
  UnitCommand,
} from './commands';
export type {
  MediaFileResult,
  MediaUploader,
  PendingMediaRecord,
  PendingMediaStore,
  PhotoAnnotateMeta,
  PhotoCropMeta,
  PhotoUploadMeta,
} from './media-types';

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
  /**
   * The tenant's editor preferences (auto-advance, pinned tags, required defect
   * fields, ...). Owner: `useInspectionPrefs` moves into the package in Task 5/8
   * and reads this instead of `/resources/inspection-prefs`. Absent means the host
   * has no preference store, and the editor uses its built-in defaults.
   * `patch` takes a partial delta; a not-ok result means the host did not save it.
   */
  prefs?: { load(): Promise<InspectionPrefs>; patch(delta: Partial<InspectionPrefs>): Promise<CommandResult> };
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
  /** The answer's `data` is typed from the command (see `CommandDataMap`). */
  execute<C extends FieldCommand>(inspectionId: string, cmd: C): Promise<CommandResult<CommandData<C>>>;
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
