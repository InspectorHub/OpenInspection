import { m } from '../i18n';
import type { OfflinePhotoBatchResult, OfflinePhotoRejectionReason } from '../collab/offline-photo-batch';
import type { MediaFileResult } from '../media-types';

/** Localized, fixed user-facing reasons; never render arbitrary host error text. */
export function offlinePhotoRejectionMessages(batch: OfflinePhotoBatchResult): string[] {
    const messages: string[] = [];
    const known = Object.values(batch.reasons).reduce((sum, count) => sum + (count ?? 0), 0);
    const append = (reason: OfflinePhotoRejectionReason, count: number) => {
        if (count === 0) return;
        const args = { count, s: count === 1 ? '' : 's' };
        messages.push(reason === 'unsupportedType'
            ? m.editor_route_photo_unsupported_type(args)
            : count === 1
                ? m.editor_route_photo_too_large_single()
                : m.editor_route_photo_too_large(args));
    };
    append('unsupportedType', batch.reasons.unsupportedType ?? 0);
    append('tooLarge', batch.reasons.tooLarge ?? 0);
    const unknown = batch.rejected - known;
    if (unknown > 0) messages.push(m.editor_route_photos_rejected({ count: unknown, s: unknown === 1 ? '' : 's' }));
    return messages;
}

/** Map only known host codes to localized copy; unknown failures stay summarized. */
export function onlinePhotoRejectionMessages(results: readonly MediaFileResult[]): string[] {
    const failures = results.filter((result) => !result.ok && result.kept !== true);
    const tooLargeCount = failures.filter((result) => result.error === 'TOO_LARGE').length;
    const otherFailureCount = failures.length - tooLargeCount;
    const messages: string[] = [];
    if (tooLargeCount === 1) messages.push(m.editor_route_photo_too_large_single());
    else if (tooLargeCount > 1) messages.push(m.editor_route_photo_too_large({ count: tooLargeCount, s: 's' }));
    if (otherFailureCount > 0) {
        const keptCount = results.filter((result) => !result.ok && result.kept === true).length;
        const successCount = results.filter((result) => result.ok).length;
        messages.push(m.editor_route_photos_partial_upload({
            success: successCount,
            total: results.length - keptCount - tooLargeCount,
            failed: otherFailureCount,
        }));
    }
    return messages;
}
