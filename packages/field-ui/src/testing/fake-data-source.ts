import * as Y from 'yjs';
import type {
  CommandData,
  CommandDataMap,
  CommandResult,
  EditorData,
  FieldCommand,
  FieldDataSource,
  FieldResources,
  FieldUrls,
  PendingMediaRecord,
  SessionInfo,
} from '../data-source';
import type { InspectionPrefs, PcaNarrative } from '../data-source-types';

export interface FakeSeed {
  data: EditorData;
  session?: Partial<SessionInfo>;
  urls?: Partial<FieldUrls>;
  /** Defaults to empty: every optional capability is absent. */
  resources?: FieldResources;
  platform?: FieldDataSource['platform'];
  /** Initial connectivity; defaults to online. */
  online?: boolean;
}

export interface ExecutedCommand {
  inspectionId: string;
  cmd: FieldCommand;
}

/** A `FieldDataSource` backed by memory, with hooks for tests to inspect and perturb it. */
export interface FakeDataSource extends FieldDataSource {
  /** Every command passed to `execute`, in call order. */
  readonly commands: readonly ExecutedCommand[];
  /** Inspection ids passed to `collab.purge`, in call order. */
  readonly purged: readonly string[];
  readonly reloadCount: number;
  readonly exitCount: number;
  /**
   * Make every later command of this type answer `{ ok: false, error }`. A response
   * registered with `respondWith` for the same command still rides along as `data`,
   * which is how a failed autofill carries its reason.
   */
  failExecute(type: FieldCommand['type'], error: string): void;
  /** Attach `data` to every later answer for this command (`type`, or `type:op`). */
  respondWith<K extends keyof CommandDataMap>(key: K, data: CommandDataMap[K]): void;
  /** Make every later `media.store.put` reject with this error. */
  failMediaPut(error: Error): void;
  /** Flip connectivity and notify subscribers. */
  setOnline(online: boolean): void;
}

const DEFAULT_SESSION: SessionInfo = {
  tenantSlug: null,
  videoProvider: 'r2',
  streamCustomerSubdomain: null,
  collabEditing: false,
  userId: 'fake-user',
  // The package never interprets a role (`SessionInfo.role` is the host's string), so the
  // fake uses a neutral value instead of one of the engine's role names.
  role: 'fake-role',
};

/** `value` unless it is undefined, so an explicit `undefined` override never erases a default. */
function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/** `type`, or `type:op` for the commands that carry an `op`. Matches `CommandKey`. */
function commandKey(cmd: FieldCommand): string {
  return 'op' in cmd ? `${cmd.type}:${cmd.op}` : cmd.type;
}

const DEFAULT_URLS: FieldUrls = {
  photo: (inspectionId, key) => `/fake/photos/${inspectionId}/${key}`,
  reportPreview: () => null,
  reportPdf: () => null,
  statutoryPreviewPdf: () => null,
  videoObject: () => null,
};

const EMPTY_PCA_NARRATIVE: PcaNarrative = {
  transmittalLetter: '',
  summaryGeneralDescription: '',
  summaryPhysicalCondition: '',
  summaryRecommendations: '',
  purpose: '',
  scopeOfWork: '',
  limitationsExceptions: '',
  reconnaissance: '',
  additionalConsiderations: '',
};

/**
 * An `EditorData` for an inspection with nothing in it. The members the loader
 * always returns as objects carry the loader's default shape; the members it can
 * return as null are null. The text defaults are empty because the real boilerplate
 * belongs to the host.
 */
export function createEmptyEditorData(overrides: Partial<EditorData> = {}): EditorData {
  return {
    inspection: { id: 'insp-1', propertyAddress: '1 Main St' },
    schema: { sections: [] },
    results: {},
    ratingLevels: [],
    tagLibrary: [],
    defectCategories: [],
    units: [],
    unitProgress: { units: [], commonRated: 0, total: 0 },
    unitInspectionMode: 'tagged',
    templateSnapshot: { schemaVersion: 2, sections: [] },
    revisionStatus: null,
    statutoryDetails: null,
    statutoryCoverage: null,
    compliance: {
      reportSignoffs: [],
      psq: null,
      documentReview: [],
      conformance: { standard: 'E2018-24', conforms: false },
    },
    pcaNarrative: { ...EMPTY_PCA_NARRATIVE },
    relianceText: { userReliance: '', pointInTime: '', siteSpecific: '' },
    commercialPresets: {},
    nextPublishIsAmendment: false,
    outboundCoolingWindow: null,
    resultId: null,
    ...overrides,
  };
}

const DEFAULT_PREFS: InspectionPrefs = {
  cloneDefault: 'rating_notes',
  autoAdvance: 'always',
  autoAdvanceDelayMs: 200,
  pinnedTagIds: [],
  requireDefectFields: 'none',
  agentRepairAccess: 'readwrite',
  reportLinkTtl: 'never',
};

/** The `prefs` resource, in memory. Pass it as `resources.prefs`. */
export interface FakePrefs {
  load(): Promise<InspectionPrefs>;
  patch(delta: Partial<InspectionPrefs>): Promise<CommandResult>;
  /** Every delta passed to a successful `patch`, in call order. */
  readonly patches: readonly Partial<InspectionPrefs>[];
  /** Make every later `patch` answer `{ ok: false, error }` and store nothing. */
  failPatch(error: string): void;
}

export function createFakePrefs(initial: Partial<InspectionPrefs> = {}): FakePrefs {
  let current: InspectionPrefs = { ...DEFAULT_PREFS, ...initial };
  let failure: string | null = null;
  const patches: Partial<InspectionPrefs>[] = [];
  return {
    get patches() {
      return patches;
    },
    failPatch(error) {
      failure = error;
    },
    load: async () => ({ ...current, pinnedTagIds: [...current.pinnedTagIds] }),
    patch: async (delta) => {
      if (failure !== null) return { ok: false, error: failure };
      patches.push(delta);
      current = { ...current, ...delta };
      return { ok: true };
    },
  };
}

export function createFakeDataSource(seed: FakeSeed): FakeDataSource {
  const commands: ExecutedCommand[] = [];
  const purged: string[] = [];
  const failures = new Map<FieldCommand['type'], string>();
  const responses = new Map<string, unknown>();
  const records = new Map<string, PendingMediaRecord>();
  const listeners = new Set<(online: boolean) => void>();
  let online = seed.online ?? true;
  let putFailure: Error | null = null;
  let reloadCount = 0;
  let exitCount = 0;

  const ds: FakeDataSource = {
    get commands() {
      return commands;
    },
    get purged() {
      return purged;
    },
    get reloadCount() {
      return reloadCount;
    },
    get exitCount() {
      return exitCount;
    },
    failExecute(type, error) {
      failures.set(type, error);
    },
    failMediaPut(error) {
      putFailure = error;
    },
    respondWith(key, data) {
      responses.set(key, data);
    },
    setOnline(next) {
      online = next;
      for (const cb of [...listeners]) cb(next);
    },

    load: async () => seed.data,
    session: () => {
      const o: Partial<SessionInfo> = seed.session ?? {};
      return {
        tenantSlug: pick(o.tenantSlug, DEFAULT_SESSION.tenantSlug),
        videoProvider: pick(o.videoProvider, DEFAULT_SESSION.videoProvider),
        streamCustomerSubdomain: pick(o.streamCustomerSubdomain, DEFAULT_SESSION.streamCustomerSubdomain),
        collabEditing: pick(o.collabEditing, DEFAULT_SESSION.collabEditing),
        userId: pick(o.userId, DEFAULT_SESSION.userId),
        role: pick(o.role, DEFAULT_SESSION.role),
      };
    },
    execute: async <C extends FieldCommand>(inspectionId: string, cmd: C): Promise<CommandResult<CommandData<C>>> => {
      commands.push({ inspectionId, cmd });
      const error = failures.get(cmd.type);
      const data = responses.get(commandKey(cmd));
      const result: CommandResult<unknown> = error === undefined ? { ok: true } : { ok: false, error };
      if (data !== undefined) result.data = data;
      // The one place the fake meets the per-command typing: `respondWith` already
      // constrained `data` to this command's `CommandDataMap` entry.
      return result as CommandResult<CommandData<C>>;
    },
    reload: () => {
      reloadCount += 1;
    },
    exit: () => {
      exitCount += 1;
    },
    isOnline: () => online,
    onOnlineChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    collab: {
      connect: (_inspectionId, opts) => {
        const doc = new Y.Doc();
        let destroyed = false;
        doc.on('update', () => {
          if (!destroyed) opts.onChange?.();
        });
        queueMicrotask(() => opts.onSynced?.());
        return {
          doc,
          persistenceSynced: Promise.resolve(),
          synced: () => true,
          destroy: () => {
            destroyed = true;
            doc.destroy();
          },
        };
      },
      purge: async (inspectionId) => {
        purged.push(inspectionId);
      },
    },
    media: {
      store: {
        put: async (rec) => {
          if (putFailure) throw putFailure;
          records.set(rec.pendingId, rec);
        },
        get: async (pendingId) => records.get(pendingId) ?? null,
        list: async (inspectionId) =>
          [...records.values()].filter((r) => inspectionId === undefined || r.inspectionId === inspectionId),
        delete: async (pendingId) => {
          records.delete(pendingId);
        },
        objectUrl: async (pendingId) => (records.has(pendingId) ? `blob:fake/${pendingId}` : null),
      },
      uploader: () => ({
        upload: async (rec) => ({ ok: true, key: `uploaded/${rec.pendingId}` }),
      }),
    },
    urls: { ...DEFAULT_URLS, ...seed.urls },
    resources: { ...seed.resources },
    platform: seed.platform ?? 'web',
  };
  return ds;
}
