import * as Y from 'yjs';
import type {
  CommandResult,
  EditorData,
  FieldCommand,
  FieldDataSource,
  FieldResources,
  FieldUrls,
  PendingMediaRecord,
  SessionInfo,
} from '../data-source';

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
  /** Make every later command of this type answer `{ ok: false, error }`. */
  failExecute(type: FieldCommand['type'], error: string): void;
  /** Make every later `media.store.put` reject with this error. */
  failMediaPut(error: Error): void;
  /** Flip connectivity and notify subscribers. */
  setOnline(online: boolean): void;
}

const DEFAULT_SESSION: SessionInfo = {
  tenantSlug: null,
  videoProvider: null,
  streamCustomerSubdomain: null,
  collabEditing: false,
  userId: 'fake-user',
  // The package never interprets a role (`SessionInfo.role` is the host's string), so the
  // fake uses a neutral value instead of one of the engine's role names.
  role: 'fake-role',
};

const DEFAULT_URLS: FieldUrls = {
  photo: (inspectionId, key) => `/fake/photos/${inspectionId}/${key}`,
  reportPreview: () => null,
  reportPdf: () => null,
  statutoryPreviewPdf: () => null,
  videoObject: () => null,
};

export function createFakeDataSource(seed: FakeSeed): FakeDataSource {
  const commands: ExecutedCommand[] = [];
  const purged: string[] = [];
  const failures = new Map<FieldCommand['type'], string>();
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
    setOnline(next) {
      online = next;
      for (const cb of [...listeners]) cb(next);
    },

    load: async () => seed.data,
    session: () => ({ ...DEFAULT_SESSION, ...seed.session }),
    execute: async (inspectionId, cmd): Promise<CommandResult> => {
      commands.push({ inspectionId, cmd });
      const error = failures.get(cmd.type);
      return error === undefined ? { ok: true } : { ok: false, error };
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
