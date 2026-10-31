import { Errors } from '../errors';
import { stripExifOnIngest, type ImagesBinding } from './strip-exif';
import { headBytes, sniffPhotoType } from './sniff';
import { MAX_PHOTO_BYTES } from '@core/field-ui/shared/photo-limits';

export { MAX_PHOTO_BYTES };

/** Content types a signed photo upload may declare, and the key extension each one is stored under. */
export const SIGNED_PHOTO_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/heic': 'heic',
} as const;

/** Spellings clients send for a type in the list above. */
const PHOTO_TYPE_ALIASES: Record<string, keyof typeof SIGNED_PHOTO_EXT> = {
    '': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/heif': 'image/heic',
};

/**
 * The canonical content type for a declared one, or null when it is not an accepted photo type. The declared
 * type is lowercased, trimmed and stripped of `;` parameters; an empty type counts as jpeg, `image/jpg` as
 * jpeg and `image/heif` as heic. Only for a DECLARED type (a package manifest names its photo entries by it);
 * what gets stored is decided by the bytes, see `sniffedPhotoType`.
 */
function canonicalPhotoType(declared: string): keyof typeof SIGNED_PHOTO_EXT | null {
    const type = (declared.split(';')[0] ?? '').trim().toLowerCase();
    if (type in SIGNED_PHOTO_EXT) return type as keyof typeof SIGNED_PHOTO_EXT;
    return PHOTO_TYPE_ALIASES[type] ?? null;
}

/** The key extension for a declared content type, or null when the type is not an accepted photo type. */
export function signedPhotoExtFor(contentType: string): string | null {
    const type = canonicalPhotoType(contentType);
    return type === null ? null : SIGNED_PHOTO_EXT[type];
}

export function isSignedPhotoExt(ext: string | undefined): ext is string {
    return !!ext && Object.values<string>(SIGNED_PHOTO_EXT).includes(ext);
}

/**
 * The photo type a file really is, from its first bytes, never from its declared type: a mislabelled genuine image
 * is stored under its real type, and a body that is not a jpeg, png or heic image (an empty one included) is a 400
 * that does not echo what was sent.
 */
async function sniffedPhotoType(file: Blob): Promise<keyof typeof SIGNED_PHOTO_EXT> {
    assertPhotoSize(file.size); // an oversized body is a 413 whatever it contains
    const type = sniffPhotoType(await headBytes(file));
    if (type === null) throw Errors.UnsupportedPhotoType('Photo is not a jpeg, png or heic image');
    return type;
}

/** The key extension for the file's real type (see `sniffedPhotoType`). */
export async function sniffedPhotoExt(file: Blob): Promise<string> {
    return SIGNED_PHOTO_EXT[await sniffedPhotoType(file)];
}

/** Refuses a photo body over the ceiling with 413, whichever route received it. */
export function assertPhotoSize(size: number): void {
    if (size > MAX_PHOTO_BYTES) throw Errors.PhotoTooLarge(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${size})`);
}

/**
 * Validate size and the real (sniffed) type, strip GPS/EXIF on ingest, and store the photo bytes at `key`.
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
    assertPhotoSize(file.size);
    const type = await sniffedPhotoType(file);
    const { bytes, contentType } = await stripExifOnIngest(images, await file.arrayBuffer(), type);
    await r2.put(key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { originalName: file.name || 'photo' },
    });
}
