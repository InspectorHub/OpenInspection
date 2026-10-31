import { headBytes, sniffPhotoType, sniffPosterType } from './media-sniff';
import { MAX_PHOTO_BYTES } from './photo-limits';

/** The fixed reasons an image can be refused for before it is queued or sent. */
export type PhotoRefusal = 'TOO_LARGE' | 'UNSUPPORTED_TYPE';

/**
 * The one admission check for an image bound for the photo store: over the server's photo ceiling, or bytes that are
 * not a jpeg, png or heic image. The type is decided by the leading bytes with the server's own sniffer, never by the
 * declared type or the file name; the size is checked first, as the server does. `null` means admissible.
 */
export async function photoRefusal(blob: Blob): Promise<PhotoRefusal | null> {
    if (blob.size > MAX_PHOTO_BYTES) return 'TOO_LARGE';
    if (sniffPhotoType(await headBytes(blob)) === null) return 'UNSUPPORTED_TYPE';
    return null;
}

/**
 * The same check for a video poster. The poster route shares the photo ceiling but stores jpeg, png and webp (not heic),
 * so the type is decided by `sniffPosterType`, the route's own sniffer.
 */
export async function posterRefusal(blob: Blob): Promise<PhotoRefusal | null> {
    if (blob.size > MAX_PHOTO_BYTES) return 'TOO_LARGE';
    if (sniffPosterType(await headBytes(blob)) === null) return 'UNSUPPORTED_TYPE';
    return null;
}
