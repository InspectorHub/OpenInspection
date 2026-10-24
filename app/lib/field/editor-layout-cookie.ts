import type { EditorLayout } from "@core/field-ui/hooks/useBreakpoint";

/**
 * The editor's layout band, remembered per device in a cookie so the SERVER can render a phone as a phone.
 *
 * Without it the server snapshot of `useEditorLayout` is always "desktop": a phone hydrates the whole desktop tree
 * and then throws it away for the phone tree. With the cookie the loader hands the remembered band to the editor as
 * `initialLayout`, so the server render and the client's first render agree; matchMedia still corrects a wrong
 * memory right after mount (a new device, a rotated tablet, a cleared cookie).
 *
 * The value is one of three fixed words and identifies nobody. Everything read from the request is untrusted: any
 * other value is "desktop", the same as no cookie.
 */
export const EDITOR_LAYOUT_COOKIE = "ih-editor-layout";

/** One year. A remembered layout is a hint, so expiry only bounds how long a stale one can live. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const LAYOUTS: readonly EditorLayout[] = ["phone", "tablet", "desktop"];

/** The band a cookie value names; anything that is not exactly one of the three words is "desktop". */
export function parseEditorLayout(value: unknown): EditorLayout {
    return typeof value === "string" && (LAYOUTS as readonly string[]).includes(value) ? (value as EditorLayout) : "desktop";
}

/** The value of cookie `name` in a `Cookie` header or `document.cookie` string, or null. The first one wins. */
function cookieValue(header: string | null | undefined, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(";")) {
        const at = part.indexOf("=");
        if (at < 0) continue;
        if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
    }
    return null;
}

/** The remembered band in a request's `Cookie` header; "desktop" when absent or not one of the three words. */
export function layoutFromCookieHeader(header: string | null | undefined): EditorLayout {
    return parseEditorLayout(cookieValue(header, EDITOR_LAYOUT_COOKIE));
}

/** The `Set-Cookie`-style string for `document.cookie`. `Secure` only on https, so a plain-http dev origin still works. */
export function layoutCookieString(layout: EditorLayout, secure: boolean): string {
    return `${EDITOR_LAYOUT_COOKIE}=${parseEditorLayout(layout)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * Remember `layout` on this device. Writes only when the stored value differs, so the common visit (same band as
 * last time) touches nothing, and a render never causes a write: this is called from the editor's observer, after
 * mount. A blocked or missing cookie jar is not an error; the editor just starts from "desktop" next time.
 */
export function rememberEditorLayout(layout: EditorLayout, doc: Pick<Document, "cookie"> | undefined = typeof document === "undefined" ? undefined : document, secure = typeof location !== "undefined" && location.protocol === "https:"): void {
    if (!doc) return;
    try {
        if (cookieValue(doc.cookie, EDITOR_LAYOUT_COOKIE) === layout) return;
        doc.cookie = layoutCookieString(layout, secure);
    } catch {
        /* cookies unavailable: a missing hint is harmless */
    }
}
