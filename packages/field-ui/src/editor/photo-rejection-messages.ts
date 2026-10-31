import { m } from '../i18n';
import type { OfflinePhotoBatchResult } from '../collab/offline-photo-batch';
import type { MediaFileResult } from '../media-types';

interface PhotoBatchTally {
    /** Files that made it (uploaded, or stored on the device). */
    added: number;
    tooLarge: number;
    unsupportedType: number;
    /** Rejected for any other reason; the reason is never shown. */
    other: number;
}

const plural = (count: number) => ({ count, s: count === 1 ? '' : 's' });

/**
 * One place for the count-to-message branching. Known reasons get a fixed sentence each; when part of the batch did
 * get through, the user also hears how many (a rejection must not hide the photos that were added). Nothing here
 * renders host error text.
 */
function photoBatchMessages(tally: PhotoBatchTally, wording: 'upload' | 'offline'): string[] {
    const { added, tooLarge, unsupportedType, other } = tally;
    const rejected = tooLarge + unsupportedType + other;
    if (rejected === 0) return [];
    const messages: string[] = [];
    if (added > 0) {
        const args = { success: added, total: added + rejected, failed: rejected };
        messages.push(wording === 'upload' ? m.editor_route_photos_partial_upload(args) : m.editor_route_photos_partial_added(args));
    }
    if (unsupportedType > 0) messages.push(m.editor_route_photo_unsupported_type(plural(unsupportedType)));
    if (tooLarge === 1) messages.push(m.editor_route_photo_too_large_single());
    else if (tooLarge > 1) messages.push(m.editor_route_photo_too_large(plural(tooLarge)));
    // With photos added, the summary above already counts the unknown failures.
    if (other > 0 && added === 0) {
        // Online, an unknown failure is a transient one (a 5xx, a dropped connection) and says nothing about the file
        // itself, so it is worded as a failed upload even next to a permanent reason, never as "could not be added".
        messages.push(wording === 'upload'
            ? m.editor_route_photos_partial_upload({ success: 0, total: other, failed: other })
            : m.editor_route_photos_rejected(plural(other)));
    }
    return messages;
}

/** Localized, fixed user-facing reasons; never render arbitrary host error text. `total` is the batch size. */
export function offlinePhotoRejectionMessages(batch: OfflinePhotoBatchResult, total: number): string[] {
    const tooLarge = batch.reasons.tooLarge ?? 0;
    const unsupportedType = batch.reasons.unsupportedType ?? 0;
    return photoBatchMessages({
        added: total - batch.rejected,
        tooLarge,
        unsupportedType,
        other: batch.rejected - tooLarge - unsupportedType,
    }, 'offline');
}

/** Map only known host codes to localized copy; unknown failures stay summarized. */
export function onlinePhotoRejectionMessages(results: readonly MediaFileResult[]): string[] {
    const failures = results.filter((result) => !result.ok && result.kept !== true);
    const count = (code: string) => failures.filter((result) => result.error === code).length;
    const tooLarge = count('TOO_LARGE');
    const unsupportedType = count('UNSUPPORTED_TYPE');
    return photoBatchMessages({
        added: results.filter((result) => result.ok).length,
        tooLarge,
        unsupportedType,
        other: failures.length - tooLarge - unsupportedType,
    }, 'upload');
}
