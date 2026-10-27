import type { FieldDataSource, FieldResources } from './data-source';
import { m } from './i18n';

const refused = () => ({ ok: false as const, error: m.editor_read_only() });
const refuse = async () => refused();

/** The resources with every write refused. A read passes through, called on the host's own object. */
function readOnlyResources(r: FieldResources): FieldResources {
  const out: FieldResources = { ...r };
  if (r.prefs) out.prefs = { load: () => r.prefs!.load(), patch: refuse };
  if (r.commentsLibrary) {
    out.commentsLibrary = { list: (q) => r.commentsLibrary!.list(q), touch: refuse, save: refuse, edit: refuse };
  }
  if (r.costItems) out.costItems = { list: (id) => r.costItems!.list(id), save: refuse };
  if (r.aiAssist) out.aiAssist = { run: refuse };
  if (r.versionHistory) {
    out.versionHistory = {
      list: (id) => r.versionHistory!.list(id),
      get: (id, seq) => r.versionHistory!.get(id, seq),
      restore: refuse,
      capture: refuse,
    };
  }
  if (r.video) {
    out.video = { createUpload: refuse, uploadFile: refuse, uploadPoster: refuse, setPoster: refuse, finalize: refuse, remove: refuse };
  }
  return out;
}

/**
 * The same data source with every write refused, for an editor that only reads. `execute`, the media store's `put` and
 * `delete`, the uploader and the resource writes answer "read-only" without reaching the host; every read (loading,
 * URLs, listings, the store's `get` / `list` / `objectUrl`, the version list) passes through to it. `notify` is not
 * wrapped, so the refusal can still be shown. The host's own object is never changed.
 */
export function readOnlyView(ds: FieldDataSource): FieldDataSource {
  const store = ds.media.store;
  return {
    ...ds,
    execute: refuse,
    media: {
      ...ds.media,
      store: {
        get: (id) => store.get(id),
        list: (inspectionId) => store.list(inspectionId),
        objectUrl: (id) => store.objectUrl(id),
        put: () => Promise.reject(new Error(m.editor_read_only())),
        delete: () => Promise.reject(new Error(m.editor_read_only())),
      },
      uploader: () => ({ upload: async () => ({ ok: false as const, error: m.editor_read_only() }) }),
    },
    resources: readOnlyResources(ds.resources),
  };
}
