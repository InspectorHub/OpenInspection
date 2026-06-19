/**
 * Plan 7 — media-type discriminator resolver for the unified media entry.
 *
 * Media entries carry an optional `mediaType` discriminator. Legacy photo
 * entries predate the discriminator and only ever carried an R2 `key`, so a
 * missing `mediaType` MUST resolve to 'photo' (no data migration needed).
 * Videos carry `mediaType: 'video'` + a Cloudflare Stream `streamUid` (Stream
 * owns the bytes; there is no R2 object, so `key` is '').
 */
import type { MediaEntry } from '../../types/inspection-item-state';

/**
 * Resolve a media entry's type. Anything that is not explicitly 'video'
 * (including legacy entries with no discriminator) is a photo.
 */
export function resolveMediaType(e: { mediaType?: string }): 'photo' | 'video' {
    return e.mediaType === 'video' ? 'video' : 'photo';
}

/**
 * Type guard: narrows to a video entry with a guaranteed non-empty
 * `streamUid`. Defensive — a video entry without a `streamUid` is invalid
 * (there is nothing to play), so it is treated as not-a-video.
 */
export function isVideoEntry(e: MediaEntry): e is MediaEntry & { streamUid: string } {
    return resolveMediaType(e) === 'video' && !!e.streamUid;
}
