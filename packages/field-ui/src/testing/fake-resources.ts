import type { FieldResources } from '../data-source';
import type {
  AiAssistInput,
  AiAssistResult,
  CommentsLibraryEntry,
  CommentsLibraryQuery,
  CommentsLibraryRow,
  CostItemView,
  CostItemWrite,
  CostItemsListing,
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

type AiAssistResource = NonNullable<FieldResources['aiAssist']>;

/** The `aiAssist` resource: records every request and answers a configurable result per intent. */
export interface FakeAiAssist extends AiAssistResource {
  /** Every request, in call order. */
  readonly runs: readonly AiAssistInput[];
  /** Replace the answer of every later `assist` (default: a draft with the call id `ai-call-1`). */
  answerAssist(result: AiAssistResult): void;
  /** Replace the answer of every later `review` (default: recorded). */
  answerReview(result: AiAssistResult): void;
  /** Make every later request wait until the returned function is called, to hold one in flight. */
  hold(): () => void;
}

export function createFakeAiAssist(): FakeAiAssist {
  const runs: AiAssistInput[] = [];
  let assist: AiAssistResult = { ok: true, intent: 'assist', text: 'Improved note', aiCallId: 'ai-call-1' };
  let review: AiAssistResult = { ok: true, intent: 'review' };
  let gate: Promise<void> | null = null;
  return {
    get runs() {
      return runs;
    },
    answerAssist(result) {
      assist = result;
    },
    answerReview(result) {
      review = result;
    },
    hold() {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
    run: async (input) => {
      runs.push(input);
      if (gate !== null) await gate;
      return input.intent === 'assist' ? assist : review;
    },
  };
}

type CostItemsResource = NonNullable<FieldResources['costItems']>;

/**
 * The `costItems` resource: lists `items`, records every list and write. A `create` answers the id `stored-N`
 * (N counting from 1); `update` and `delete` answer ok. `hold` keeps every later write in flight.
 */
export interface FakeCostItems extends CostItemsResource {
  /** Inspection ids passed to `list`, in call order. */
  readonly lists: readonly string[];
  /** Every write passed to `save`, in call order. */
  readonly writes: readonly { inspectionId: string; write: CostItemWrite }[];
  /** Replace the lines every later `list` answers. */
  setItems(items: CostItemView[]): void;
  /** Replace the reserve-schedule switch every later `list` answers. */
  setReserveEnabled(enabled: boolean): void;
  /** Make every later `save` answer `{ ok: false }`. */
  failSave(): void;
  /** Keep every later `save` in flight until the returned function is called. */
  hold(): () => void;
}

export function createFakeCostItems(initial: CostItemView[] = []): FakeCostItems {
  let items = initial;
  let reserveEnabled = false;
  let saveFails = false;
  let gate: Promise<void> | null = null;
  let stored = 0;
  const lists: string[] = [];
  const writes: { inspectionId: string; write: CostItemWrite }[] = [];
  return {
    get lists() {
      return lists;
    },
    get writes() {
      return writes;
    },
    setItems(next) {
      items = next;
    },
    setReserveEnabled(enabled) {
      reserveEnabled = enabled;
    },
    failSave() {
      saveFails = true;
    },
    hold() {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
    list: async (inspectionId): Promise<CostItemsListing> => {
      lists.push(inspectionId);
      return { items, reserveEnabled };
    },
    save: async (inspectionId, write) => {
      writes.push({ inspectionId, write });
      if (gate !== null) await gate;
      if (saveFails) return { ok: false };
      if (write.intent === 'create') {
        stored += 1;
        return { ok: true, data: { id: `stored-${stored}` } };
      }
      return { ok: true };
    },
  };
}

