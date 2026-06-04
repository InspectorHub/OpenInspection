/**
 * Content-Disposition helpers for streaming stored files (photos, attachments)
 * back to the browser with their original filename.
 *
 * The sanitization strips characters that could break out of the quoted
 * `filename="..."` token or inject extra header directives (quotes,
 * backslashes, CR/LF) and collapses path separators so a crafted upload name
 * cannot smuggle a path. Mirrors the message-attachment serve route (B-5).
 */
export function sanitizeFilename(name: string | null | undefined, fallback = 'file'): string {
    const cleaned = (name ?? '')
        .replace(/["\\\r\n]/g, '')
        .replace(/[/\\]/g, '_')
        .slice(0, 200)
        .trim();
    return cleaned || fallback;
}

/**
 * Build a Content-Disposition header value. `inline` lets the browser render
 * the image in-page (gallery / report viewer); `attachment` forces a download
 * named after the original file. Callers flip `download` from a `?download=1`
 * query flag.
 */
export function contentDisposition(
    name: string | null | undefined,
    download: boolean,
    fallback = 'photo',
): string {
    const safe = sanitizeFilename(name, fallback);
    return `${download ? 'attachment' : 'inline'}; filename="${safe}"`;
}
