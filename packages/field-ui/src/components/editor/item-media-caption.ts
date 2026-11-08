import { m } from "../../i18n";
import { resolveMediaType } from "../../shared/media-type";

/**
 * The line under an item's media strip: "2 photos", or "1 photo, 1 video" when the item has both. Null for an empty list so the
 * caller can show its own empty copy. Photos and videos share one list on the item; `mediaType` tells them apart.
 */
export function itemMediaCaption(entries: ReadonlyArray<{ key?: string; mediaType?: string; provider?: string; mediaId?: string; streamUid?: string }>): string | null {
  const videos = entries.filter((e) => resolveMediaType(e) === "video").length;
  const photos = entries.length - videos;
  if (entries.length === 0) return null;
  const photoText = photos === 1 ? m.editor_item_photo_count_one({ count: photos }) : m.editor_item_photo_count_other({ count: photos });
  const videoText = videos === 1 ? m.editor_item_video_count_one({ count: videos }) : m.editor_item_video_count_other({ count: videos });
  if (videos === 0) return photoText;
  if (photos === 0) return videoText;
  return m.editor_item_media_count({ photos: photoText, videos: videoText });
}
