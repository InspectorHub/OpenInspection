import { Errors } from '../errors';
import { stripExifOnIngest, type ImagesBinding } from './strip-exif';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Content types a signed photo upload may declare, and the key extension each one is stored under. */
export const SIGNED_PHOTO_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/heic': 'heic',
} as const;

/** The key extension for a declared content type, or null when the type is not one a signed upload accepts. */
export function signedPhotoExtFor(contentType: string): string | null {
    for (const [type, ext] of Object.entries(SIGNED_PHOTO_EXT)) if (type === contentType) return ext;
    return null;
}

export function isSignedPhotoExt(ext: string | undefined): ext is string {
    return !!ext && Object.values<string>(SIGNED_PHOTO_EXT).includes(ext);
}

/**
 * Validate size, strip GPS/EXIF on ingest, and store the photo bytes at `key`.
 * The one place the item-photo, pool-photo and signed-URL upload paths all
 * write through, so the size ceiling and the metadata strip cannot diverge.
 *
 * The EXIF strip is a fallback for any path that skipped the client canvas
 * bake; it fails open when `images` is absent (standalone). The original
 * filename is kept in customMetadata so the serve route can set
 * Content-Disposition without parsing it back out of the key.
 */
export async function storePhotoAtKey(
    r2: R2Bucket,
    images: ImagesBinding | undefined,
    key: string,
    file: File,
): Promise<void> {
    if (file.size > MAX_PHOTO_BYTES) {
        throw Errors.BadRequest(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${file.size})`);
    }
    const { bytes, contentType } = await stripExifOnIngest(images, await file.arrayBuffer(), file.type || 'image/jpeg');
    await r2.put(key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { originalName: file.name || 'photo' },
    });
}
