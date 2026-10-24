import type { CostItemView, TemplateSummary } from './data-source-types';
import type { GalleryPhoto } from './shared/inspection-media';
import type { ResultsProjection } from './shared/results-doc.types';

/** Data types of the host resources (cost lines, repair items, media pool, settings sheet, version history, video). */

/**
 * The cost lines of one inspection, as the host's cost-items read answers them. `reserveEnabled` is the
 * tenant's reserve-schedule switch (it shows the EUL / effective age / RUL fields); a host that cannot
 * read it answers false, which hides them.
 */
export interface CostItemsListing {
  items: CostItemView[];
  reserveEnabled: boolean;
}

/**
 * One write to the cost lines. `create` answers the stored line's id as `data.id` (the panel swaps its
 * draft id for it); `update` replaces the stored line by id; `delete` removes it by id.
 */
export type CostItemWrite =
  | { intent: 'create'; item: CostItemView }
  | { intent: 'update'; item: CostItemView }
  | { intent: 'delete'; itemId: string };

/** One catalogue entry the repair-item picker offers. */
export interface RepairItemOption {
  id: string;
  name: string;
  category: string | null;
  defaultRepairSummary: string;
  contractorTypeName: string | null;
}

/**
 * The photos of an inspection as the gallery lists them. `answered` is the difference between "this
 * inspection has no photos" (answered, empty) and "no answer came back" (not answered): only the first
 * may be shown as a statement about the inspection.
 */
export interface MediaPoolListing {
  photos: GalleryPhoto[];
  answered: boolean;
}

/** One photo the report-cover picker offers. */
export interface CoverPhotoOption {
  key: string;
  url: string;
  label: string;
}

/** One report appearance profile the settings sheet offers. Presentational: only its id and name. */
export interface ReportProfileOption {
  id: string;
  name: string;
}

/**
 * What the inspection settings sheet reads when it opens. `inspection` is the stored inspection row (null
 * when the host has none to give); the sheet reads `templateId`, `requireDefectFieldsOverride`,
 * `profileOverride`, `coverPhotoId` / `coverPhoto` and `coverCrop` off it.
 */
export interface SettingsSheetData {
  inspection: Record<string, unknown> | null;
  templates: TemplateSummary[];
  photos: CoverPhotoOption[];
  profiles: ReportProfileOption[];
}

/** One stored version of an inspection's report content. */
export interface VersionSnapshotEntry {
  seq: number;
  atMs: number;
  byUserId: string | null;
  /** Why it was captured; absent on legacy rows. */
  reason?: 'periodic' | 'manual' | 'connect';
}

/** One stored version's content: the per-finding projection a compare diffs against the live results. */
export interface VersionSnapshotContent {
  projection: ResultsProjection;
}

/** The provider-specific reference a video upload is addressed by. */
export type VideoUploadRef =
  | { provider: 'stream'; streamUid: string }
  | { provider: 'r2'; mediaId: string; r2Key: string };

/**
 * What `video.createUpload` answers: where to send the bytes and the backend reference the upload will
 * end up under. For r2 the `ref` is a placeholder; the real `mediaId` and `r2Key` come back from the
 * file upload.
 */
export interface VideoUploadTicket {
  uploadURL: string;
  provider: 'stream' | 'r2';
  ref: VideoUploadRef;
}

/** What `video.finalize` takes: the final reference (r2 may carry the poster frame's key). */
export type VideoFinalizeInput =
  | { provider: 'stream'; streamUid: string }
  | { provider: 'r2'; mediaId: string; r2Key: string; posterKey?: string };
