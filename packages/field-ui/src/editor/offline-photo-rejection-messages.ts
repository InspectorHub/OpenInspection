import { m } from '../i18n';
import type { OfflinePhotoBatchResult, OfflinePhotoRejectionReason } from '../collab/offline-photo-batch';

/** Localized, fixed user-facing reasons; never render arbitrary host error text. */
export function offlinePhotoRejectionMessages(batch: OfflinePhotoBatchResult): string[] {
    const messages: string[] = [];
    const known = Object.values(batch.reasons).reduce((sum, count) => sum + (count ?? 0), 0);
    const append = (reason: OfflinePhotoRejectionReason, count: number) => {
        if (count === 0) return;
        const args = { count, s: count === 1 ? '' : 's' };
        messages.push(reason === 'unsupportedType'
            ? m.editor_route_photo_unsupported_type(args)
            : m.editor_route_photo_too_large(args));
    };
    append('unsupportedType', batch.reasons.unsupportedType ?? 0);
    append('tooLarge', batch.reasons.tooLarge ?? 0);
    const unknown = batch.rejected - known;
    if (unknown > 0) messages.push(m.editor_route_photos_rejected({ count: unknown, s: unknown === 1 ? '' : 's' }));
    return messages;
}
