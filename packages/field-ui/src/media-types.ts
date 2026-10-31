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

/**
 * A baked crop of an existing photo. Cropping always re-derives from the ORIGINAL `photoKey`.
 *
 * `photoKey` is the authority; `photoIndex` is only the position the photo had when the
 * record was queued. The route addresses a photo by index and does not check the key, so
 * an uploader MUST re-resolve the index from `findingKey` + `photoKey` against the current
 * results document at upload time (the web uploader does this in `app/lib/field/web-uploader.ts`) and
 * must fail the record when the photo is gone, never trust the queued index: a photo
 * removed while the device was offline would otherwise shift every later index and land
 * the crop on a different photo. Task 4 owns this when the drain moves into the package.
 */
export interface PhotoCropMeta extends PendingMediaTarget {
  photoIndex: number;
  photoKey: string;
  crop: PhotoCropTransform;
  /** Optional on the route; omitted when the item has no section hint. */
  sectionId?: string;
}

/**
 * A baked annotation layered on a photo. `nodesJson` is the serialised annotation node tree.
 * `photoKey` is authoritative and `photoIndex` a queued snapshot, exactly as for `PhotoCropMeta`.
 */
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
  /**
   * Must reject on failure. A host may attach a stable `code` to the error;
   * the editor recognizes `UNSUPPORTED_TYPE` and `TOO_LARGE` for safe photo
   * guidance. Unknown errors keep the generic rejection notice.
   */
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
  /** A fixed host code such as `TOO_LARGE`, `NO_KEY`, `HTTP_<status>` or `EXCEPTION`; never render arbitrary values. */
  error?: string;
  /** The upload failed but the host kept the bytes on the device (see `MediaUploader`): not a lost photo. */
  kept?: boolean;
  /** The host refused the file itself (see `MediaUploader`): nothing is waiting to be saved, so it is not a failed save. */
  permanent?: boolean;
}

/**
 * Online media upload. It is NOT a `FieldCommand`: the editor never routes photo
 * bytes through `execute`, because a command is a small structured write and
 * this is a binary body that the offline queue must also be able to replay.
 *
 * One call uploads one record (one file). The `upload-photo` action takes a batch
 * and answers `{ ok, keys: string[], results: MediaFileResult[], itemId, targetType,
 * customId, defectKind }`; a host that batches maps each file to one `upload` call.
 * The single `key` / `result` here are that file's outcome: `results[index]` lines up with
 * the file's position in the batch, while `keys[]` holds only the successful files and is
 * not aligned with it, so read `results[index].key` rather than `keys[index]`.
 *
 * - `kind: 'photo'`: `key` is the stored photo key.
 * - `kind: 'crop'`: `key` is the derived `croppedKey`.
 * - `kind: 'annotate'`: `key` is the derived `annotatedKey`.
 *
 * Failure is `{ ok: false, error }` and never a throw. `permanent: true` says the host will refuse these very bytes every time
 * (the server rejected the file itself, not the connection): the offline drain then stops retrying the queued record. A host that stored the bytes on the device and wrote the
 * pending entry itself (see `appendPendingPhoto`) adds `kept: true`: the photo is not lost and uploads later, so the
 * editor counts it as saved on the device instead of as a failure.
 */
export interface MediaUploader {
  upload(rec: PendingMediaRecord): Promise<{ ok: true; key: string; result?: MediaFileResult } | { ok: false; error: string; kept?: true; permanent?: true }>;
}
