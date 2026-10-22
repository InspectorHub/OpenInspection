import type * as Y from 'yjs';
import type { ReactNode } from 'react';
import type { DateFormat, TimeFormat } from './shared/display-prefs';
import type { CommandData, CommandResult, FieldCommand } from './commands';
import type { PendingMediaStore, MediaUploader } from './media-types';
import type {
  AiAssistInput,
  AiAssistResult,
  CommercialPresets,
  CompliancePanelData,
  CostItemsListing,
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
  CommentsLibraryEntry,
  CommentsLibraryQuery,
  CommentsLibraryRow,
  TagLibraryEntry,
  TemplateSchema,
  TemplateSearchResult,
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
  /** The company's video backend; the session-context contract always answers one of the two. */
  videoProvider: 'r2' | 'stream';
  streamCustomerSubdomain: string | null;
  collabEditing: boolean;
  /** Replaces the editor's hard-coded presence user id. */
  userId: string;
  role: string;
  /**
   * The VIEWER's display language: user override, else the tenant default, else
   * 'en-US' (`useDisplayLocale`). Language follows the viewer on every surface.
   */
  locale: string;
  /**
   * The VIEWER's display time zone (IANA id): user override, else the tenant's.
   * Null when the host has none to give; the package then falls back to 'UTC',
   * which is where `useDisplayTimeZone` ends (the tenant column is NOT NULL
   * DEFAULT 'UTC', so the web host never answers null).
   */
  timeZone: string | null;
  /**
   * The VIEWER's date order, resolved per field (user, else tenant, else 'us'),
   * for workspace chrome (`useChromeDateTimeFormat`). Never use it for a date a
   * second party also reads.
   */
  dateFormat: DateFormat;
  /** The VIEWER's clock, resolved like `dateFormat`. */
  timeFormat: TimeFormat;
  /**
   * The TENANT's date order, ignoring any personal override: the shape for
   * inspection, report and appointment dates (`useInspectionDateTimeFormat` /
   * `useTenantFormatPrefs`). Resolved with the same fallback as `dateFormat`.
   */
  tenantDateFormat: DateFormat;
  /** The TENANT's clock; see `tenantDateFormat`. */
  tenantTimeFormat: TimeFormat;
}

/** Per-call options of `notify`. `durationMs` replaces the host's default display time for the variant. */
export interface NotifyOptions {
  durationMs?: number;
}

/**
 * Per-call options of `execute`. The key is the write's idempotency key: the
 * host adapter forwards it as the `Idempotency-Key` (the web host writes it into
 * the `idempotencyKey` form field the route action relays). `useFieldCommand`
 * owns its lifetime; calling `execute` directly without one is allowed and simply
 * is not idempotent.
 */
export interface ExecuteOptions {
  idempotencyKey?: string;
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
  /**
   * The collaborative-presence WebSocket URL (absolute `ws:`/`wss:`). Today
   * `usePresence` builds it from `window.location`.
   */
  presenceSocket(inspectionId: string): string;
  /** The in-app path of this inspection's editor (the publish dialog reads `window.location.pathname`). */
  editorPath(inspectionId: string): string;
}

/**
 * Optional host capabilities. An absent member hides its entry point.
 * The `unknown` payloads are tightened by plan B Task 8, which gives each
 * capability the concrete shape its panel reads.
 */
export interface FieldResources {
  /**
   * The tenant's editor preferences (auto-advance, pinned tags, required defect
   * fields, ...). Owner: `useInspectionPrefs`, which reads and saves through this
   * (the web host serves it from `/resources/inspection-prefs`). Absent means the host
   * has no preference store, and the editor uses its built-in defaults.
   * `patch` takes a partial delta; a not-ok result means the host did not save it, and
   * an ok result carries the host's validated, merged preferences as `data`, which the
   * editor adopts in place of its optimistic copy.
   */
  prefs?: {
    load(): Promise<InspectionPrefs>;
    patch(delta: Partial<InspectionPrefs>): Promise<CommandResult<InspectionPrefs>>;
  };
  /**
   * The tenant's canned-comment library. Owner: `useCannedComments` (the web host serves it from
   * `/resources/comments-library`). `list` never rejects: a failed read answers `[]`. `save` creates
   * an entry, `edit` replaces one, `touch` records one use; a not-ok answer means the host did not
   * store it. There is no remove: the library page deletes through its own route.
   */
  commentsLibrary?: {
    list(query?: CommentsLibraryQuery): Promise<CommentsLibraryRow[]>;
    touch(id: string): Promise<CommandResult>;
    save(entry: CommentsLibraryEntry): Promise<CommandResult>;
    edit(id: string, entry: CommentsLibraryEntry): Promise<CommandResult>;
  };
  /** `list` never rejects: a failed read answers no items. `save` stays untyped until its consumer converts. */
  costItems?: { list(inspectionId: string): Promise<CostItemsListing>; save(payload: unknown): Promise<CommandResult> };
  repairItems?: { list(inspectionId: string): Promise<unknown> };
  mediaPool?: { list(inspectionId: string): Promise<unknown> };
  settingsSheet?: { load(inspectionId: string): Promise<unknown> };
  /**
   * AI writing assistance for an inspection note (the web host serves it from `/resources/ai-assist`).
   * Never rejects: every failure answers `{ ok: false, error }`. The caller owns the same-frame guard:
   * an `assist` spends a metered AI call.
   */
  aiAssist?: { run(input: AiAssistInput): Promise<AiAssistResult> };
  publishReadiness?: { check(inspectionId: string): Promise<unknown> };
  /** The template picker's search. Typed from the existing route loader (see `TemplateSearchResult`). */
  templateSearch?: { search(input: { q: string; page: number }): Promise<TemplateSearchResult> };
  versionHistory?: {
    // Payloads stay `unknown` until the batch that converts VersionHistoryPanel types them.
    list(inspectionId: string): Promise<unknown>;
    get(inspectionId: string, seq: number): Promise<unknown>;
    restore(inspectionId: string, seq: number): Promise<CommandResult>;
    /** The "Save version now" POST. */
    capture(inspectionId: string): Promise<CommandResult>;
  };
  video?: {
    // `createUpload`/`finalize` payloads stay `unknown` until the batch that converts VideoCapture types them.
    createUpload(inspectionId: string): Promise<unknown>;
    uploadPoster(inspectionId: string, blob: Blob): Promise<CommandResult>;
    /** Pick the poster frame of a Stream video; `posterPct` is 0..1. */
    setPoster(inspectionId: string, input: { streamUid: string; posterPct: number }): Promise<CommandResult>;
    finalize(inspectionId: string, payload: unknown): Promise<CommandResult>;
    remove(inspectionId: string, ref: string): Promise<CommandResult>;
  };
}

/**
 * Host-supplied UI, injected through `FieldDataSourceProvider` rather than read
 * from the data source: the package renders the entry point, the host owns the
 * implementation.
 */
export interface FieldHostSlots {
  /** The theme switch shown in the header (the web host passes `ThemeSegmentControl`). Absent hides it. */
  renderThemeControl?: (props: { className?: string }) => ReactNode;
  /**
   * PDF export, kept in the host (it needs the host's download machinery).
   * `run` starts the export for the inspection; the rest is what the header
   * reads off `usePdfExport`. Absent hides the PDF entry points.
   */
  pdf?: {
    run(inspectionId: string): void;
    busy: boolean;
    /** The last failure's sentence, or null. */
    error: string | null;
    /** Button text: the host's `pdfActionLabel`, which swaps in "Generating" / "Retry in N s". */
    actionLabel(defaultLabel: string): string;
  };
}

export interface FieldDataSource {
  load(inspectionId: string, scope?: string): Promise<EditorData>;
  session(): SessionInfo;
  /** The answer's `data` is typed from the command (see `CommandDataMap`). */
  execute<C extends FieldCommand>(inspectionId: string, cmd: C, opts?: ExecuteOptions): Promise<CommandResult<CommandData<C>>>;
  /** Show a transient message (replaces the host's toast inside the package). */
  notify(message: string, variant?: 'info' | 'success' | 'error', opts?: NotifyOptions): void;
  reload(): void;
  exit(): void;
  isOnline(): boolean;
  onOnlineChange(cb: (online: boolean) => void): () => void;
  collab: CollabConnector;
  media: {
    store: PendingMediaStore;
    /**
     * `doc` is the live results document, or null when the host has none yet. A crop or
     * annotation addresses its photo by index, so the uploader resolves the CURRENT index from
     * `doc` at upload time and answers `{ ok: false }` when `doc` is null or the photo is gone.
     */
    uploader(inspectionId: string, doc: Y.Doc | null): MediaUploader;
  };
  urls: FieldUrls;
  resources: FieldResources;
  platform: 'web' | 'ios' | 'android';
}
