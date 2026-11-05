/**
 * Serving the object a report link photo request names.
 *
 * The key is resolved to the full storage key and its ownership checked first (report-link-keys.ts). An inspection photo is then
 * served as a photo; a credential badge as a brand asset, so it keeps its vector content type and its size variant.
 */
import { resolveReportPhotoKey } from './report-link-keys';
import { servePhotoObject, imagesBinding } from './media/serve-photo';
import { serveBrandAssetObject } from './media/serve-brand-asset';

/** A report link URL is private to its holder, so what it serves is not cached for anyone else. Same as an inspection photo. */
const PRIVATE_CACHE = 'private, max-age=300';

interface ReportPhotoRequest {
    key: string;
    width: string | undefined;
    download: boolean;
    /** The raw `?v=` badge variant; only a credential badge reads it. */
    variant: string | undefined;
}

/** The response for the requested key, or null when the key is outside this company and inspection or the object is missing. */
export async function serveReportPhoto(env: { PHOTOS?: R2Bucket | undefined }, request: ReportPhotoRequest, tenantId: string, inspectionId: string): Promise<Response | null> {
    const fullKey = resolveReportPhotoKey(request.key, tenantId, inspectionId);
    if (fullKey === null || !env.PHOTOS) return null;
    if (fullKey.startsWith(`${tenantId}/credentials/`)) return serveBrandAssetObject(env.PHOTOS, env, fullKey, request.variant, PRIVATE_CACHE);
    return servePhotoObject(env.PHOTOS, imagesBinding(env), fullKey, { width: request.width, download: request.download });
}
