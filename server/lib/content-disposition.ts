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
/** RFC 5987 ext-value encoding: percent-encode everything outside the attr-char set. */
function encodeRfc5987(name: string): string {
    return encodeURIComponent(name)
        // encodeURIComponent leaves !'()* — RFC 5987 attr-char forbids them
        .replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function contentDisposition(
    name: string | null | undefined,
    download: boolean,
    fallback = 'photo',
): string {
    const safe = sanitizeFilename(name, fallback);
    const disp = download ? 'attachment' : 'inline';
    const star = encodeRfc5987(name && name.trim() ? name : safe);
    return `${disp}; filename="${safe}"; filename*=UTF-8''${star}`;
}
