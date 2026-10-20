import type { PhotoCropTransform } from './data-source-types';

/**
 * What a pending record needs to be attached once its bytes have uploaded. The
 * `findingKey` is the composite key the results document is keyed by
 * (`<unit>:<section>:<item>`; `_default` for the common scope), which is how the
 * drain finds the doc entry to swap the real key into.
 */
interface PendingMediaTarget {
  findingKey: string;
  itemId: string;
}

/**
 * A photo bound for an item, or for one defect row of an item. Mirrors the
 * `upload-photo` form fields of the inspection-edit action: `itemId` always;
 * `customId` and `defectKind` only with `targetType: 'defect'`.
 */
export type PhotoUploadMeta =
  | (PendingMediaTarget & { targetType: 'item' })
  | (PendingMediaTarget & { targetType: 'defect'; customId: string; defectKind: 'canned' | 'custom' });

/** A baked crop of an existing photo. Cropping always re-derives from the ORIGINAL `photoKey`. */
export interface PhotoCropMeta extends PendingMediaTarget {
  photoIndex: number;
  photoKey: string;
  crop: PhotoCropTransform;
  /** Optional on the route; omitted when the item has no section hint. */
  sectionId?: string;
}

/** A baked annotation layered on a photo. `nodesJson` is the serialised annotation node tree. */
export interface PhotoAnnotateMeta extends PendingMediaTarget {
  photoIndex: number;
  photoKey: string;
  nodesJson: string;
  sectionId?: string;
}

interface PendingMediaBase {
  pendingId: string;
  inspectionId: string;
  blob: Blob;
  createdAt: number;
}

/** `kind` decides which `meta` it carries, so a consumer narrows on `kind` and never casts. */
export type PendingMediaRecord =
  | (PendingMediaBase & { kind: 'photo'; meta: PhotoUploadMeta })
  | (PendingMediaBase & { kind: 'crop'; meta: PhotoCropMeta })
  | (PendingMediaBase & { kind: 'annotate'; meta: PhotoAnnotateMeta });

export interface PendingMediaStore {
  /** Must reject on failure. */
  put(rec: PendingMediaRecord): Promise<void>;
  get(pendingId: string): Promise<PendingMediaRecord | null>;
  list(inspectionId?: string): Promise<PendingMediaRecord[]>;
  delete(pendingId: string): Promise<void>;
  /** Web: URL.createObjectURL; app: Capacitor.convertFileSrc. */
  objectUrl(pendingId: string): Promise<string | null>;
}

/**
 * One file's outcome, the same element shape as `results[]` in the
 * `upload-photo` action's answer (`index` is the file's position in its batch).
 */
export interface MediaFileResult {
  index: number;
  ok: boolean;
  key?: string;
  /** `NO_KEY`, `HTTP_<status>` or `EXCEPTION`. */
  error?: string;
}

/**
 * Online media upload. It is NOT a `FieldCommand`: the editor never routes photo
 * bytes through `execute`, because a command is a small structured write and
 * this is a binary body that the offline queue must also be able to replay.
 *
 * One call uploads one record (one file). The `upload-photo` action takes a batch
 * and answers `{ ok, keys: string[], results: MediaFileResult[], itemId, targetType,
 * customId, defectKind }`; a host that batches maps each file to one `upload` call,
 * and the single `key` / `result` here are that file's entry of `keys[]` / `results[]`.
 *
 * - `kind: 'photo'`: `key` is the stored photo key.
 * - `kind: 'crop'`: `key` is the derived `croppedKey`.
 * - `kind: 'annotate'`: `key` is the derived `annotatedKey`.
 *
 * Failure is `{ ok: false, error }` and never a throw.
 */
export interface MediaUploader {
  upload(rec: PendingMediaRecord): Promise<{ ok: true; key: string; result?: MediaFileResult } | { ok: false; error: string }>;
}
