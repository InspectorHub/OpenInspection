import type { FieldResources } from '../data-source';
import type {
  CommentsLibraryEntry,
  CommentsLibraryQuery,
  CommentsLibraryRow,
  TemplateSearchResult,
} from '../data-source-types';

/** The `templateSearch` resource: answers `result` (an empty single page by default) and records each input. */
export interface FakeTemplateSearch {
  search(input: { q: string; page: number }): Promise<TemplateSearchResult>;
  readonly searches: readonly { q: string; page: number }[];
  /** Replace the page every later search answers. */
  setResult(result: TemplateSearchResult): void;
}

export function createFakeTemplateSearch(initial?: TemplateSearchResult): FakeTemplateSearch {
  let result: TemplateSearchResult = initial ?? { templates: [], hasMore: false, page: 1, totalPages: 1 };
  const searches: { q: string; page: number }[] = [];
  return {
    get searches() {
      return searches;
    },
    setResult(next) {
      result = next;
    },
    search: async (input) => {
      searches.push(input);
      return result;
    },
  };
}

type VersionHistoryResource = NonNullable<FieldResources['versionHistory']>;
type VideoResource = NonNullable<FieldResources['video']>;

/** The `versionHistory` resource: lists nothing, records every capture and restore. */
export interface FakeVersionHistory extends VersionHistoryResource {
  /** Inspection ids passed to `capture`, in call order. */
  readonly captures: readonly string[];
  /** `{ inspectionId, seq }` passed to `restore`, in call order. */
  readonly restores: readonly { inspectionId: string; seq: number }[];
  /** Make every later `capture` answer `{ ok: false, error }`. */
  failCapture(error: string): void;
}

export function createFakeVersionHistory(): FakeVersionHistory {
  const captures: string[] = [];
  const restores: { inspectionId: string; seq: number }[] = [];
  let captureFailure: string | null = null;
  return {
    get captures() {
      return captures;
    },
    get restores() {
      return restores;
    },
    failCapture(error) {
      captureFailure = error;
    },
    list: async () => [],
    get: async () => null,
    restore: async (inspectionId, seq) => {
      restores.push({ inspectionId, seq });
      return { ok: true };
    },
    capture: async (inspectionId) => {
      captures.push(inspectionId);
      return captureFailure === null ? { ok: true } : { ok: false, error: captureFailure };
    },
  };
}

/** The `video` resource: every member answers a neutral success; `setPoster` calls are recorded. */
export interface FakeVideo extends VideoResource {
  /** Arguments of every `setPoster`, in call order. */
  readonly posters: readonly { inspectionId: string; streamUid: string; posterPct: number }[];
}

export function createFakeVideo(): FakeVideo {
  const posters: { inspectionId: string; streamUid: string; posterPct: number }[] = [];
  return {
    get posters() {
      return posters;
    },
    createUpload: async () => null,
    uploadPoster: async () => ({ ok: true }),
    setPoster: async (inspectionId, input) => {
      posters.push({ inspectionId, ...input });
      return { ok: true };
    },
    finalize: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
  };
}

type CommentsLibraryResource = NonNullable<FieldResources['commentsLibrary']>;

/** The `commentsLibrary` resource: lists `rows`, records every list, touch, save and edit. */
export interface FakeCommentsLibrary extends CommentsLibraryResource {
  /** The query of every `list`, in call order (`undefined` when none was passed). */
  readonly lists: readonly (CommentsLibraryQuery | undefined)[];
  readonly touches: readonly string[];
  /** The entry of every stored `save`, in call order. */
  saved(): readonly CommentsLibraryEntry[];
  /** The id and entry of every `edit`, in call order. */
  edited(): readonly { id: string; entry: CommentsLibraryEntry }[];
  /** Replace the rows every later `list` answers. */
  setRows(rows: CommentsLibraryRow[]): void;
  /** Make every later `save` answer `{ ok: false, error }` and store nothing. */
  failSave(error: string): void;
}

export function createFakeCommentsLibrary(initial: CommentsLibraryRow[] = []): FakeCommentsLibrary {
  let rows = initial;
  let saveFailure: string | null = null;
  const lists: (CommentsLibraryQuery | undefined)[] = [];
  const touches: string[] = [];
  const saves: CommentsLibraryEntry[] = [];
  const edits: { id: string; entry: CommentsLibraryEntry }[] = [];
  return {
    get lists() {
      return lists;
    },
    get touches() {
      return touches;
    },
    saved: () => saves,
    edited: () => edits,
    setRows(next) {
      rows = next;
    },
    failSave(error) {
      saveFailure = error;
    },
    list: async (query) => {
      lists.push(query);
      return rows;
    },
    touch: async (id) => {
      touches.push(id);
      return { ok: true };
    },
    save: async (entry) => {
      if (saveFailure !== null) return { ok: false, error: saveFailure };
      saves.push(entry);
      return { ok: true };
    },
    edit: async (id, entry) => {
      edits.push({ id, entry });
      return { ok: true };
    },
  };
}
