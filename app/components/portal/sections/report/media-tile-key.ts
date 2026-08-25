/**
 * The React key for one media tile in the report render.
 *
 * Pulled out of <ReportView>'s JSX because the inline form was a five-deep
 * nested ternary, and kept as its own module rather than a local function for
 * the reason everything else next door is: the component sits at the large-file
 * limit, and "how a photo or a video is keyed" is a thing a reader looks up by
 * name.
 *
 * Videos key on their stream/media id, which is stable across reorders; photos
 * key on their storage key.
 */
import type { ReportPhoto } from "./types";

export function mediaTileKey(photo: ReportPhoto, idx: number): string {
  const media = photo.media;
  switch (media?.kind) {
    case "video-player":
      return `v-${media.streamUid}-${idx}`;
    case "video-poster":
      return `vp-${media.streamUid}-${idx}`;
    case "r2-video-player":
      return `r2v-${media.mediaId}-${idx}`;
    case "r2-video-poster":
      return `r2vp-${media.mediaId}-${idx}`;
    default:
      return photo.key;
  }
}
