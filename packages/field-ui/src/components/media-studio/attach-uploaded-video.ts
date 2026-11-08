import { m } from "../../i18n";
import type { NotifyOptions, NotifyVariant } from "../../data-source";
import type { VideoEntry } from "../../shared/results-doc";
import type { VideoUploaded } from "./VideoCapture";

/**
 * The entry that puts a finished clip on an item, or null when there is nothing to put there yet. An R2 clip is addressed by its
 * pool row id (what every serve and delete route looks up), a Stream clip by its stream uid; neither has an R2 `key`. An empty pool
 * id means the host queued the upload on the device (native, offline): the clip will be attached when it is really uploaded.
 */
export function videoEntryFrom(clip: VideoUploaded): VideoEntry | null {
  if (!clip.poolId) return null;
  const length = clip.durationSec === undefined ? {} : { durationSec: clip.durationSec };
  if (clip.provider === "stream") {
    return { key: "", mediaType: "video", provider: "stream", streamUid: clip.streamUid, ...length };
  }
  return {
    key: "",
    mediaType: "video",
    provider: "r2",
    mediaId: clip.poolId,
    ...(clip.posterKey ? { posterKey: clip.posterKey } : {}),
    ...length,
  };
}

export interface AttachDeps {
  /** Writes the clip into the item; `false` when the editor could not (not connected, locked, an item it cannot place). */
  addVideoToItem: (itemId: string, entry: VideoEntry) => boolean;
  notify: (message: string, variant?: NotifyVariant, opts?: NotifyOptions) => void;
  reload: () => void;
}

/** How long the "could not be added" message stays: the clip is uploaded but invisible, so the person has to see this. */
const ATTACH_FAILED_MS = 10_000;

/**
 * After an upload: put the clip on the item it was started from and say what happened. Success is announced only when the document
 * took the clip; when it did not, the person is told the clip is uploaded but not on the item, never that it worked.
 */
export function attachUploadedVideo(clip: VideoUploaded, itemId: string, deps: AttachDeps): void {
  const entry = videoEntryFrom(clip);
  if (!entry) {
    deps.reload();
    return;
  }
  if (deps.addVideoToItem(itemId, entry)) {
    deps.notify(m.editor_video_added(), "success");
    return;
  }
  deps.notify(m.editor_video_attach_failed(), "error", { durationMs: ATTACH_FAILED_MS });
  deps.reload();
}
