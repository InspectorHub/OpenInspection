/**
 * Best-effort original filename for display from an R2 photo key (A-9).
 *
 * Photo keys are shaped `${tenantId}/${inspectionId}/<prefix>_<uuid>_<original>`
 * (item photos: prefix = itemId; pool photos: prefix = `_pool`). We take the
 * final path segment and strip the leading `<prefix>_<uuid>_` so the trailing
 * original filename remains. This is a display label only — the authoritative
 * name (used for the download Content-Disposition) comes from the object's
 * stored `customMetadata.originalName` on the serve route.
 */
const UUID_TAIL = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(.+)$/i;

export function photoDisplayName(key: string): string {
    const seg = key.split('/').pop() || key;
    const m = seg.match(UUID_TAIL);
    return (m ? m[1] : seg) || 'photo';
}

/**
 * Append the `download=1` flag to a photo URL so the serve route returns it as
 * an attachment named after the original file. Handles URLs that already carry
 * a query string (e.g. the public report viewer's `?token=`).
 */
export function withDownload(url: string): string {
    return url.includes('?') ? `${url}&download=1` : `${url}?download=1`;
}
