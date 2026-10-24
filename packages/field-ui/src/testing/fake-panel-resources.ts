import type { FieldResources } from '../data-source';
import type {
  MediaPoolListing,
  RepairItemOption,
  SettingsSheetData,
  VersionSnapshotContent,
  VersionSnapshotEntry,
  VideoFinalizeInput,
  VideoUploadTicket,
} from '../data-source-types';

type VersionHistoryResource = NonNullable<FieldResources['versionHistory']>;
type VideoResource = NonNullable<FieldResources['video']>;

/** The `versionHistory` resource: lists `snapshots`, records every capture, restore and get. */
export interface FakeVersionHistory extends VersionHistoryResource {
  /** Inspection ids passed to `capture`, in call order. */
  readonly captures: readonly string[];
  /** `{ inspectionId, seq }` passed to `restore`, in call order. */
  readonly restores: readonly { inspectionId: string; seq: number }[];
  /** `{ inspectionId, seq }` passed to `get`, in call order. */
  readonly gets: readonly { inspectionId: string; seq: number }[];
  /** Number of `list` calls. */
  readonly lists: number;
  /** Replace the versions every later `list` answers. */
  setSnapshots(snapshots: VersionSnapshotEntry[]): void;
  /** Replace the content every later `get` answers. */
  setContent(content: VersionSnapshotContent): void;
  /** Make every later `list` answer not-ok (the host could not read it). */
  failList(error?: string): void;
  /** Make every later `get` answer not-ok. */
  failGet(error?: string): void;
  /** Make every later `capture` answer `{ ok: false, error }`. */
  failCapture(error: string): void;
  /** Make every later `restore` answer `{ ok: false, error }`. */
  failRestore(error: string): void;
}

/** A not-ok answer, with `error` only when the host gave one. */
function notOk(failure: { error?: string }): { ok: false; error?: string } {
  return failure.error === undefined ? { ok: false } : { ok: false, error: failure.error };
}

export function createFakeVersionHistory(initial: VersionSnapshotEntry[] = []): FakeVersionHistory {
  const captures: string[] = [];
  const restores: { inspectionId: string; seq: number }[] = [];
  const gets: { inspectionId: string; seq: number }[] = [];
  let snapshots = initial;
  let content: VersionSnapshotContent = { projection: {} };
  let lists = 0;
  let listFailure: { error?: string } | null = null;
  let getFailure: { error?: string } | null = null;
  let captureFailure: string | null = null;
  let restoreFailure: string | null = null;
  return {
    get captures() {
      return captures;
    },
    get restores() {
      return restores;
    },
    get gets() {
      return gets;
    },
    get lists() {
      return lists;
    },
    setSnapshots(next) {
      snapshots = next;
    },
    setContent(next) {
      content = next;
    },
    failList(error) {
      listFailure = error === undefined ? {} : { error };
    },
    failGet(error) {
      getFailure = error === undefined ? {} : { error };
    },
    failCapture(error) {
      captureFailure = error;
    },
    failRestore(error) {
      restoreFailure = error;
    },
    list: async () => {
      lists += 1;
      return listFailure === null ? { ok: true, data: snapshots } : notOk(listFailure);
    },
    get: async (inspectionId, seq) => {
      gets.push({ inspectionId, seq });
      return getFailure === null ? { ok: true, data: content } : notOk(getFailure);
    },
    restore: async (inspectionId, seq) => {
      restores.push({ inspectionId, seq });
      return restoreFailure === null ? { ok: true } : { ok: false, error: restoreFailure };
    },
    capture: async (inspectionId) => {
      captures.push(inspectionId);
      return captureFailure === null ? { ok: true } : { ok: false, error: captureFailure };
    },
  };
}

/**
 * The `video` resource. Every member answers a neutral success (a stream ticket, a pool row `pool-1`) and
 * records its call; `fail*` makes a step answer not-ok, `holdCreateUpload` keeps one in flight until released.
 */
export interface FakeVideo extends VideoResource {
  /** Arguments of every `setPoster`, in call order. */
  readonly posters: readonly { inspectionId: string; streamUid: string; posterPct: number }[];
  /** `{ inspectionId, input }` of every `createUpload`, in call order. */
  readonly createUploads: readonly { inspectionId: string; input: { itemId?: string } }[];
  /** File names of every `uploadFile`, in call order. */
  readonly uploadedFiles: readonly string[];
  /** Number of `uploadPoster` calls. */
  readonly posterUploads: number;
  /** The input of every `finalize`, in call order. */
  readonly finalizes: readonly { inspectionId: string; input: VideoFinalizeInput }[];
  /** Replace the ticket every later `createUpload` answers. */
  setTicket(ticket: VideoUploadTicket): void;
  /** Make every later `createUpload` answer `{ ok: false }` (with `error` when given). */
  failCreateUpload(error?: string): void;
  /** Make every later `uploadFile` answer `{ ok: false }`. */
  failUploadFile(error?: string): void;
  /** Make every later `finalize` answer `{ ok: false }`. */
  failFinalize(error?: string): void;
  /** Keep every later `createUpload` in flight until the returned function is called. */
  holdCreateUpload(): () => void;
}

export function createFakeVideo(): FakeVideo {
  const posters: { inspectionId: string; streamUid: string; posterPct: number }[] = [];
  const createUploads: { inspectionId: string; input: { itemId?: string } }[] = [];
  const uploadedFiles: string[] = [];
  const finalizes: { inspectionId: string; input: VideoFinalizeInput }[] = [];
  let posterUploads = 0;
  let ticket: VideoUploadTicket = {
    uploadURL: 'https://upload.example/stream',
    provider: 'stream',
    ref: { provider: 'stream', streamUid: 'uid-1' },
  };
  let createFailure: { error?: string } | null = null;
  let fileFailure: { error?: string } | null = null;
  let finalizeFailure: { error?: string } | null = null;
  let createGate: Promise<void> | null = null;
  return {
    get posters() {
      return posters;
    },
    get createUploads() {
      return createUploads;
    },
    get uploadedFiles() {
      return uploadedFiles;
    },
    get posterUploads() {
      return posterUploads;
    },
    get finalizes() {
      return finalizes;
    },
    setTicket(next) {
      ticket = next;
    },
    failCreateUpload(error) {
      createFailure = error === undefined ? {} : { error };
    },
    failUploadFile(error) {
      fileFailure = error === undefined ? {} : { error };
    },
    failFinalize(error) {
      finalizeFailure = error === undefined ? {} : { error };
    },
    holdCreateUpload() {
      let release: () => void = () => undefined;
      createGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        createGate = null;
        release();
      };
    },
    createUpload: async (inspectionId, input) => {
      createUploads.push({ inspectionId, input });
      if (createGate !== null) await createGate;
      return createFailure === null ? { ok: true, data: ticket } : notOk(createFailure);
    },
    uploadFile: async (t, file, onProgress) => {
      uploadedFiles.push(file instanceof File ? file.name : 'blob');
      onProgress(100);
      if (fileFailure !== null) return notOk(fileFailure);
      return t.provider === 'r2' ? { ok: true, data: { mediaId: 'media-1', r2Key: 'r2/media-1.mp4' } } : { ok: true };
    },
    uploadPoster: async () => {
      posterUploads += 1;
      return { ok: true, data: { posterKey: 'poster-1' } };
    },
    setPoster: async (inspectionId, input) => {
      posters.push({ inspectionId, ...input });
      return { ok: true };
    },
    finalize: async (inspectionId, input) => {
      finalizes.push({ inspectionId, input });
      return finalizeFailure === null ? { ok: true, data: { poolId: 'pool-1' } } : notOk(finalizeFailure);
    },
    remove: async () => ({ ok: true }),
  };
}

/** The `repairItems` resource: lists `items` and counts the reads. */
export interface FakeRepairItems extends NonNullable<FieldResources['repairItems']> {
  readonly lists: number;
  setItems(items: RepairItemOption[]): void;
}

export function createFakeRepairItems(initial: RepairItemOption[] = []): FakeRepairItems {
  let items = initial;
  let lists = 0;
  return {
    get lists() {
      return lists;
    },
    setItems(next) {
      items = next;
    },
    list: async () => {
      lists += 1;
      return items;
    },
  };
}

/** The `mediaPool` resource: answers `listing` (an answered, empty pool by default) and records each read. */
export interface FakeMediaPool extends NonNullable<FieldResources['mediaPool']> {
  readonly lists: readonly string[];
  setListing(listing: MediaPoolListing): void;
}

export function createFakeMediaPool(initial?: MediaPoolListing): FakeMediaPool {
  let listing: MediaPoolListing = initial ?? { photos: [], answered: true };
  const lists: string[] = [];
  return {
    get lists() {
      return lists;
    },
    setListing(next) {
      listing = next;
    },
    list: async (inspectionId) => {
      lists.push(inspectionId);
      return listing;
    },
  };
}

/** The `settingsSheet` resource: answers `data` (an empty sheet by default, `null` once `setData(null)`) and records each read. */
export interface FakeSettingsSheet extends NonNullable<FieldResources['settingsSheet']> {
  readonly loads: readonly string[];
  setData(data: SettingsSheetData | null): void;
}

export function createFakeSettingsSheet(initial?: SettingsSheetData | null): FakeSettingsSheet {
  let data: SettingsSheetData | null =
    initial === undefined ? { inspection: null, templates: [], photos: [], profiles: [] } : initial;
  const loads: string[] = [];
  return {
    get loads() {
      return loads;
    },
    setData(next) {
      data = next;
    },
    load: async (inspectionId) => {
      loads.push(inspectionId);
      return data;
    },
  };
}
