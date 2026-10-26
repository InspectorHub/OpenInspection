/** The video types the engine stores, the key extension each one gets, and the size limit for one clip. */
export const MIME_TO_EXT: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
};

export function mimeToExt(mime: string): string {
    return MIME_TO_EXT[mime] ?? 'mp4';
}

export const ALLOWED_VIDEO_MIMES = new Set(Object.keys(MIME_TO_EXT));
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MiB
/** The cap on the single-request (multipart form) video route, which buffers the whole clip; larger clips use the chunked route. */
export const MAX_FORM_VIDEO_BYTES = 64 * 1024 * 1024; // 64 MiB
/** Every part of a chunked upload but the last has exactly this many bytes. Above storage's 5 MiB minimum, small enough to buffer. */
export const VIDEO_PART_BYTES = 8 * 1024 * 1024;
/** Chunked uploads one member may have in flight at once. */
export const MAX_OPEN_VIDEO_UPLOADS = 5;
