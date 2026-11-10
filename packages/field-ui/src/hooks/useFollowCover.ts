import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { StoredCoverCrop } from "../components/media-studio/CoverCropper";

/**
 * The report cover names a photo by the key it shows. A crop or annotation baked again gets a new key, so a cover that
 * pointed at the file the photo showed until now moves to the new one (the server does the same, see `followCover` in
 * `inspection-annotations.service.ts`). A cover on any other photo is left alone.
 *
 * The baked cover file (`coverImageKey`, made on the client from the old image; the report prefers it) is dropped either
 * way, so the report cover is the photo as the editor shows it rather than a stale image.
 * `frameChanged`: a crop changes the image's frame, so the cover crop rectangle (measured in the old frame) goes too. An
 * annotation keeps the frame, so the rectangle (and the cover crop this session saved) stay under the new key and
 * "Adjust cover" reopens on it; saving there bakes the cover again, with the strokes.
 */
export function useFollowCover<I extends Record<string, unknown>>(
  setInspection: (update: (prev: I) => I) => void,
  setSessionCoverCrop: Dispatch<SetStateAction<{ key: string; crop: StoredCoverCrop } | null>>,
): (from: string, to: string, frameChanged: boolean) => void {
  return useCallback((from, to, frameChanged) => {
    setInspection((prev) => (prev.coverPhotoId === from ? { ...prev, coverPhotoId: to, coverImageKey: null, ...(frameChanged ? { coverCrop: null } : {}) } : prev));
    setSessionCoverCrop((cur) => (cur?.key !== from ? cur : frameChanged ? null : { ...cur, key: to }));
  }, [setInspection, setSessionCoverCrop]);
}
