/**
 * Active content in an SVG.
 *
 * An SVG is a document, not just a picture: opened directly (not through an img tag) it can run script in the origin that serves it.
 * Brand assets (company logos, credential badges) are served from the application origin, so an SVG upload is accepted only if it is
 * made of a fixed set of drawing elements, carries no event attributes, links only to ids inside itself, and reaches nothing outside
 * itself. Everything else is refused. Every brand asset is also served with a sandbox policy (see serve-brand-asset.ts) so that
 * anything stored before this rule cannot run either.
 *
 * This is an allowlist, not a list of known-bad patterns: markup is split into tags and attributes, entity and character references are
 * decoded BEFORE any value is judged, and elements are matched on their local name whatever prefix they carry.
 */

/** Drawing elements (lower case; compared on the local name, after any prefix). Nothing that scripts, animates, embeds or fetches. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
    'svg', 'g', 'defs', 'symbol', 'use', 'image', 'a', 'title', 'desc', 'style',
    'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath',
    'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'marker', 'filter',
    'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'feflood', 'femerge', 'femergenode',
    'femorphology', 'feturbulence', 'fedropshadow', 'fecomponenttransfer', 'fefuncr', 'fefuncg', 'fefuncb', 'fefunca',
    // Editor metadata that real exports carry (Inkscape and similar): inert text and attributes.
    'namedview', 'metadata', 'rdf', 'work', 'format', 'type', 'description', 'license', 'creator', 'agent', 'date', 'rights',
    'subject', 'source', 'language', 'publisher', 'contributor', 'identifier', 'relation', 'coverage', 'guide', 'grid',
]);

const NAMED_REFERENCES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes character references; null when the text holds a reference the document could not define (no DTD is allowed). */
function decodeReferences(text: string): string | null {
    let bad = false;
    const out = text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]*));/g, (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
        if (name !== undefined) {
            const named = NAMED_REFERENCES[name];
            if (named === undefined) { bad = true; return ''; }
            return named;
        }
        const code = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16);
        if (!Number.isFinite(code) || code > 0x10ffff) { bad = true; return ''; }
        return String.fromCodePoint(code);
    });
    // A bare ampersand (one that starts no reference) is not well-formed XML.
    if (bad || /&/.test(text.replace(/&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]*);/g, ''))) return null;
    return out;
}

const MAX_CSS_CHARS = 256 * 1024;
/** The longest SVG text read at all: the embedded raster allowance (1 MB of base64) plus room for the drawing around it. */
const MAX_SVG_CHARS = 1536 * 1024;

/** The CSS without its comments, or null when a comment never ends. Linear: each comment is found with indexOf. */
function stripCssComments(css: string): string | null {
    let out = '';
    let at = 0;
    for (;;) {
        const open = css.indexOf('/*', at);
        if (open < 0) return out + css.slice(at);
        const close = css.indexOf('*/', open + 2);
        if (close < 0) return null;
        out += css.slice(at, open) + ' ';
        at = close + 2;
    }
}

/** True when CSS text can reach outside the document or run: imports, external urls, escapes, legacy script hooks. */
function cssIsUnsafe(css: string): boolean {
    // Bounded, and scanned without backtracking over unterminated input: a logo's styles are small, and a hostile file must not cost more than its size.
    if (css.length > MAX_CSS_CHARS) return true;
    const text = stripCssComments(css);
    if (text === null) return true;
    if (/\\/.test(text)) return true;
    if (/@import|expression\s*\(|javascript\s*:|vbscript\s*:|behaviou?r\s*:|-moz-binding/i.test(text)) return true;
    return !urlsAreInternal(text);
}

/**
 * True when every url( reference in the text points at an id inside the document. Linear: each reference is found with indexOf from where
 * the last one ended, and one that is not closed, or that contains another '(' before it closes, is refused at once.
 */
function urlsAreInternal(text: string): boolean {
    const low = text.toLowerCase();
    let at = 0;
    for (;;) {
        const open = low.indexOf('url(', at);
        if (open < 0) return true;
        const close = low.indexOf(')', open + 4);
        if (close < 0) return false;
        const inner = text.slice(open + 4, close);
        if (inner.includes('(')) return false;
        if (!inner.trim().replace(/^['"]/, '').trim().startsWith('#')) return false;
        at = close + 1;
    }
}

function localName(name: string): string {
    const colon = name.lastIndexOf(':');
    return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}

/** The one embedded picture allowed: a raster image as base64 (no nested SVG, no text, no other type), at most 1 MB of base64. */
const EMBEDDED_RASTER = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_EMBEDDED_BASE64_CHARS = 1024 * 1024;

/** True when one attribute (name and raw value) of the element `element` (local name) is acceptable. */
function attributeIsSafe(element: string, name: string, rawValue: string): boolean {
    const local = localName(name);
    if (local.startsWith('on')) return false;
    const value = decodeReferences(rawValue);
    if (value === null) return false;
    if (local === 'href') {
        if (/^#[^\s]+$/.test(value)) return true;
        // Only an <image> may carry data, and only an embedded raster picture; every other link must point at an id inside the document.
        return element === 'image' && value.length - value.indexOf(',') - 1 <= MAX_EMBEDDED_BASE64_CHARS && EMBEDDED_RASTER.test(value);
    }
    // Keep only printable characters (visible ASCII and everything from U+00A0 up), so a control character or a space cannot split a scheme.
    const squashed = value.replace(NOT_PRINTABLE, '').toLowerCase();
    if (/(?:javascript|vbscript|data):/.test(squashed) && local !== 'd') return false;
    if (local === 'style') return !cssIsUnsafe(value);
    return urlsAreInternal(value) && !/@import/i.test(value);
}

// Everything that is not visible ASCII or U+00A0 and above: controls, spaces and the C1 range. Built from a string so the source holds no raw whitespace.
const NOT_PRINTABLE = new RegExp('[^\u0021-\u007e\u00a0-\uffff]', 'g');

const NAME_AT = /(\/?)([^\s/>!?"'=<]+)/y;
const ATTRIBUTE_AT = /\s*([^\s=/"'<>]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const TAIL_AT = /\s*(\/?)>/y;

/**
 * True when the SVG text carries anything outside the allowlist.
 *
 * One left-to-right pass: every step either consumes input or returns, and every pattern is anchored at the current position (sticky), so
 * the cost is proportional to the size of the text. A '<' that does not begin a tag this scanner understands makes the file unsafe on the
 * spot, and a raw '<' inside an attribute value is refused (it is not well-formed XML, and a reader that disagrees about where a tag ends
 * is how markup gets smuggled past a check).
 */
export function svgHasActiveContent(svgText: string): boolean {
    if (svgText.length > MAX_SVG_CHARS) return true;
    if (svgText.includes('\u0000') || svgText.charCodeAt(0) === 0xfeff) return true;
    const declared = /^\s*<\?xml(?=\s)[^>]*?\bencoding\s*=\s*["']([^"']+)["']/i.exec(svgText);
    if (declared && !/^utf-?8$/i.test(declared[1] ?? '')) return true;
    // The leading XML declaration is the only markup that is not an element or a comment.
    const body = svgText.replace(/^\s*<\?xml(?=\s)[^>]*\?>/i, '');

    let cursor = 0;
    // The open elements, by local name. A close tag must match the innermost open one, so what is a child of what cannot be misread.
    const open: string[] = [];
    let first = true;
    // True while the innermost open element is <style>. A <style> may hold only text (any child element is refused), so "inside a
    // style" and "directly inside a style" are the same thing, and every text segment inside one is judged as CSS.
    let inStyle = false;
    for (;;) {
        const lt = body.indexOf('<', cursor);
        const text = body.slice(cursor, lt < 0 ? body.length : lt);
        const decoded = decodeReferences(text);
        if (decoded === null || (inStyle && cssIsUnsafe(decoded))) return true;
        if (lt < 0) break;
        if (body.startsWith('<!--', lt)) {
            const end = body.indexOf('-->', lt + 4);
            // A comment that never ends, or one inside a style element (where it could hide CSS from the check), is refused.
            if (end < 0 || inStyle) return true;
            cursor = end + 3;
            continue;
        }
        NAME_AT.lastIndex = lt + 1;
        const name = NAME_AT.exec(body);
        if (!name) return true;
        const closing = name[1] === '/';
        const local = localName(name[2] ?? '');
        if (!ALLOWED_ELEMENTS.has(local)) return true;
        // A style element holds text only: an element inside it would end the text segment the CSS check reads.
        if (inStyle && !closing) return true;
        if (first) {
            if (closing || local !== 'svg') return true;
            first = false;
        }
        let at = NAME_AT.lastIndex;
        if (!closing) {
            for (;;) {
                ATTRIBUTE_AT.lastIndex = at;
                const attribute = ATTRIBUTE_AT.exec(body);
                if (!attribute) break;
                if (!attributeIsSafe(local, attribute[1] ?? '', attribute[2] ?? attribute[3] ?? '')) return true;
                at = ATTRIBUTE_AT.lastIndex;
            }
        }
        TAIL_AT.lastIndex = at;
        const tail = TAIL_AT.exec(body);
        // Anything between the attributes and the end of the tag (an unquoted value, a stray quote, a '<') cannot be judged.
        if (!tail || (closing && tail[1] === '/')) return true;
        const selfClosing = tail[1] === '/';
        cursor = TAIL_AT.lastIndex;
        if (closing) {
            if (open.pop() !== local) return true;
            if (local === 'style') inStyle = false;
            continue;
        }
        if (!selfClosing) {
            open.push(local);
            if (local === 'style') inStyle = true;
        }
    }
    return first || open.length !== 0;
}

/**
 * True when the uploaded bytes may be stored as a brand SVG. The bytes must be well-formed UTF-8 with no byte-order mark (another
 * encoding could hide markup from a text check that a browser would still read), and must pass `svgHasActiveContent`.
 */
export function svgBytesAreSafe(bytes: ArrayBuffer | Uint8Array): boolean {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) return false;
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(view);
    } catch {
        return false;
    }
    return !svgHasActiveContent(text);
}

const REFUSAL_ACTIVE = 'The SVG contains script or other active content. Export it as a plain image and upload that.';
const REFUSAL_DOCTYPE = 'The SVG contains a DOCTYPE declaration, which is not accepted. Remove that line, or re-save the file as plain SVG (for example with SVGO), and upload it again.';

/**
 * Why an uploaded SVG is refused, as a message for the person uploading, or null when it may be stored. A DOCTYPE gets its own message:
 * many editors write one, and it is the one refusal the person can fix by deleting a line.
 */
export function svgUploadRefusal(bytes: ArrayBuffer | Uint8Array): string | null {
    if (svgBytesAreSafe(bytes)) return null;
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(view);
    } catch {
        return REFUSAL_ACTIVE;
    }
    return /<!doctype/i.test(text) ? REFUSAL_DOCTYPE : REFUSAL_ACTIVE;
}

/** Response headers that stop a stored asset from running as a page: no script, no navigation, no sniffing. */
export const BRAND_ASSET_SAFETY_HEADERS: Readonly<Record<string, string>> = {
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
};
