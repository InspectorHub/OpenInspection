import type { FieldResources } from '../data-source';
import type { TemplateSearchResult } from '../data-source-types';

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
