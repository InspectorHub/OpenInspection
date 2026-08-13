/**
 * CalDAV over `fetch`.
 *
 * Workers allows every HTTP method except CONNECT, so `PROPFIND` and `REPORT`
 * go out as ordinary requests — checked before any of this was written, because
 * it would have been a blocker.
 *
 * `davFetch` returns the raw `Response`. Status interpretation belongs to the
 * caller: a 404 means "this event is gone" on a write and "no such collection"
 * on a read, and one function cannot honestly mean both.
 */

export interface DavAuth {
    username: string;
    password: string;
}

export type DavMethod = 'PROPFIND' | 'REPORT' | 'PUT' | 'DELETE' | 'GET';

export interface DavRequestOptions {
    auth: DavAuth;
    depth?: '0' | '1';
    body?: string;
    contentType?: string;
    ifMatch?: string;
    ifNoneMatch?: string;
}

const USER_AGENT = 'OpenInspection-Calendar/1.0';

/**
 * `Basic base64(user:password)`. Only the FIRST colon separates the two, so a
 * password containing one is carried intact — app-specific passwords are
 * dash-separated today, but nothing guarantees that.
 *
 * `btoa` is Latin-1 only; encode UTF-8 first so a non-ASCII Apple ID does not
 * throw.
 */
function basicAuth(auth: DavAuth): string {
    const bytes = new TextEncoder().encode(`${auth.username}:${auth.password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
}

export async function davFetch(
    method: DavMethod,
    url: string,
    opts: DavRequestOptions,
): Promise<Response> {
    const headers: Record<string, string> = {
        // Never logged, never returned, never put in an error message.
        Authorization: basicAuth(opts.auth),
        'User-Agent': USER_AGENT,
    };
    if (opts.depth) headers.Depth = opts.depth;
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    if (opts.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;

    return fetch(url, {
        method,
        headers,
        ...(opts.body === undefined ? {} : { body: opts.body }),
    });
}

/**
 * Turn a multistatus `href` into something fetchable.
 *
 * They are usually absolute PATHS (`/1234567/calendars/home/`), occasionally
 * absolute URLs, and occasionally relative segments. Resolving against the
 * collection URL is not optional: skipping it produces requests to the wrong
 * origin, which fail in a way that reads like a bad credential.
 */
export function resolveHref(base: string, href: string): string {
    return new URL(href, base).toString();
}
