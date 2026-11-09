import { useCallback } from "react";
import { liveGalleryRow } from "../shared/live-gallery-row";
import type { GalleryPhoto } from "../shared/inspection-media";
import type { usePhotoOps } from "./usePhotoOps";

/** A drawer row as the editor has it now (see `liveGalleryRow`), read from the live results. */
export function useLiveGalleryRow(getItemPhotos: ReturnType<typeof usePhotoOps>["getItemPhotos"] | undefined): (row: GalleryPhoto) => GalleryPhoto {
  return useCallback(
    (row) => (row.itemId && getItemPhotos ? liveGalleryRow(row, getItemPhotos(row.itemId, row.sectionId)) : row),
    [getItemPhotos],
  );
}
