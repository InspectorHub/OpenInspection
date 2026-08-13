/**
 * CalDAV XML — four fixed request bodies and one narrow, defensive parse.
 *
 * No XML dependency. The bodies never vary, and the only response shape we read
 * is `multistatus`, whose structure is three nested element names deep. A
 * general DOM would be a bundle cost and an attack surface bought for nothing.
 *
 * The parse is DEFENSIVE, not correct-in-general: it never throws, it ignores
 * everything it does not recognise, and on anything malformed it returns an
 * empty list. A calendar sync that silently sees no events is recoverable; one
 * that throws inside the cron sweep is not.
 */

const XML_HEAD = '<?xml version="1.0" encoding="utf-8" ?>';

/** Step one of discovery: which principal is this app-specific password? */
export const PROPFIND_PRINCIPAL = `${XML_HEAD}
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`;

/** Step two: where does that principal keep its calendars? */
export const PROPFIND_HOME_SET = `${XML_HEAD}
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;

/** The collections inside the home, and enough to tell a calendar from an inbox. */
export const PROPFIND_CALENDARS = `${XML_HEAD}
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

/** The five XML entities, and nothing else. */
function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function decodeEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, '\'')
        .replace(/&amp;/g, '&');
}

/** `20260714T000000Z` — the only form a CalDAV time-range attribute accepts. */
function toIcalUtc(d: Date): string {
    return `${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * A time-bounded read of one collection. The only interpolated values are two
 * UTC timestamps we generated ourselves; they are escaped anyway, because a
 * body builder that trusts its inputs is one refactor away from not being able
 * to.
 */
export function buildCalendarQuery(range: { from: Date; to: Date }): string {
    const start = escapeXml(toIcalUtc(range.from));
    const end = escapeXml(toIcalUtc(range.to));
    return `${XML_HEAD}
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start}" end="${end}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

/**
 * RFC 6578 delta. The token is opaque and server-issued — meaningful only to
 * the collection that issued it — so it is echoed back escaped and never
 * inspected. A null token asks for the initial full synchronisation.
 */
export function buildSyncCollection(token: string | null): string {
    const tokenEl = token ? `<d:sync-token>${escapeXml(token)}</d:sync-token>` : '<d:sync-token/>';
    return `${XML_HEAD}
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  ${tokenEl}
  <d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
</d:sync-collection>`;
}

export interface DavResponse {
    href: string;
    /** The status the server reported for the props we kept, when it reported one. */
    status: number | null;
    /**
     * Prop values by LOCAL name — `d:href`, `D:href` and `href` are one key.
     * The value is the prop element's inner content: plain text for a text
     * prop, raw markup for a structural one like `resourcetype`. Use
     * `firstHrefIn` / `hasElement` to read the structural ones.
     */
    props: Record<string, string | undefined>;
}

/** Strips any namespace prefix: `C:calendar-home-set` -> `calendar-home-set`. */
function localName(tag: string): string {
    const colon = tag.indexOf(':');
    return (colon === -1 ? tag : tag.slice(colon + 1)).toLowerCase();
}

/**
 * Every occurrence of one element by LOCAL name, as [innerContent, ...].
 * Self-closing elements yield an empty string.
 */
function elements(xml: string, name: string): string[] {
    const out: string[] = [];
    const open = new RegExp(`<([A-Za-z0-9_.-]+:)?${name}(\\s[^>]*?)?(/)?>`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = open.exec(xml)) !== null) {
        if (match[3]) { out.push(''); continue; }
        const prefix = match[1] ?? '';
        const close = `</${prefix}${name}>`;
        // Search case-insensitively: the closing tag must match the opening
        // one's prefix, but servers are inconsistent about case.
        const endIdx = xml.toLowerCase().indexOf(close.toLowerCase(), open.lastIndex);
        if (endIdx === -1) continue;   // truncated — ignore rather than throw
        out.push(xml.slice(open.lastIndex, endIdx));
        open.lastIndex = endIdx + close.length;
    }
    return out;
}

/** `<![CDATA[x]]>` -> `x`; then the five entities. Nothing else is decoded. */
function textOf(inner: string): string {
    const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    if (cdata) return cdata[1]!;
    return decodeEntities(inner.trim());
}

/** `HTTP/1.1 404 Not Found` -> 404. */
function statusCode(inner: string | undefined): number | null {
    if (!inner) return null;
    const m = inner.match(/\s(\d{3})\s?/);
    return m ? Number(m[1]) : null;
}

/** The first `<href>` inside a structural prop, resolved by the CALLER. */
export function firstHrefIn(inner: string | undefined): string | null {
    if (!inner) return null;
    const hrefs = elements(inner, 'href');
    return hrefs.length ? textOf(hrefs[0]!) : null;
}

/** Whether a structural prop contains an element with this local name. */
export function hasElement(inner: string | undefined, name: string): boolean {
    if (!inner) return false;
    return new RegExp(`<([A-Za-z0-9_.-]+:)?${name}(\\s|/|>)`, 'i').test(inner);
}

/**
 * Walk a multistatus into one entry per `<response>`.
 *
 * Props are taken only from 2xx propstats: a 404 propstat lists the props the
 * server does NOT have, and merging those would report an empty display name as
 * though the server had sent one.
 */
export function parseMultistatus(xml: string): DavResponse[] {
    if (!xml || !/<([A-Za-z0-9_.-]+:)?multistatus/i.test(xml)) return [];
    try {
        const out: DavResponse[] = [];
        for (const response of elements(xml, 'response')) {
            const hrefs = elements(response, 'href');
            if (!hrefs.length) continue;
            const href = textOf(hrefs[0]!);
            if (!href) continue;

            const props: Record<string, string | undefined> = {};
            let kept: number | null = null;
            let first: number | null = null;

            const propstats = elements(response, 'propstat');
            // Some servers answer a single-prop PROPFIND with a bare <prop>.
            const blocks = propstats.length ? propstats : [response];
            for (const block of blocks) {
                const code = statusCode(elements(block, 'status')[0]);
                if (first === null) first = code;
                if (code !== null && (code < 200 || code >= 300)) continue;
                for (const propBlock of elements(block, 'prop')) {
                    for (const [, prefix, tag, inner] of eachChild(propBlock)) {
                        void prefix;
                        const key = localName(tag);
                        if (key === 'prop') continue;
                        // CDATA is text by definition, even when it contains
                        // something that looks like markup — check it first.
                        const isCdata = /^\s*<!\[CDATA\[/.test(inner);
                        props[key] = !isCdata && /<[A-Za-z]/.test(inner) ? inner.trim() : textOf(inner);
                    }
                }
                if (kept === null) kept = code;
            }
            out.push({ href, status: kept ?? first, props });
        }
        return out;
    } catch {
        // Defensive by contract: a malformed body yields nothing, never a throw.
        return [];
    }
}

/** Immediate-ish children of a `<prop>` block as [full, prefix, tag, inner]. */
function eachChild(block: string): Array<[string, string, string, string]> {
    const out: Array<[string, string, string, string]> = [];
    const re = /<([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)(\s[^>]*?)?(\/)?>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(block)) !== null) {
        const prefix = match[1] ?? '';
        const tag = match[2]!;
        if (match[4]) { out.push([match[0], prefix, tag, '']); continue; }
        const close = `</${prefix}${tag}>`;
        const endIdx = block.toLowerCase().indexOf(close.toLowerCase(), re.lastIndex);
        if (endIdx === -1) continue;
        out.push([match[0], prefix, tag, block.slice(re.lastIndex, endIdx)]);
        re.lastIndex = endIdx + close.length;
    }
    return out;
}
