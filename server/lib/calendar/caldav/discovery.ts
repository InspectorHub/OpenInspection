/**
 * CalDAV discovery — two `PROPFIND`s, and we store the home the SERVER named.
 *
 * What the user typed is a starting point, not an answer: it may be a bare
 * hostname, an Apple ID URL, or nothing at all, and iCloud routes each account
 * to a numbered shard (`p42-caldav.icloud.com`) that no user could know to
 * type. Storing the typed value would work until the shard moved.
 */
import { logger } from '../../logger';
import { CalendarConnectError } from '../provider';
import { davFetch, resolveHref, type DavAuth } from './client';
import { PROPFIND_PRINCIPAL, PROPFIND_HOME_SET, parseMultistatus, firstHrefIn } from './xml';

/** Where discovery starts when the user supplies no address of their own. */
export const ICLOUD_CALDAV_BASE = 'https://caldav.icloud.com';

const DAV_CONTENT_TYPE = 'application/xml; charset=utf-8';

/**
 * The server rejected the Apple ID or the app-specific password.
 *
 * Separate from the structural failure below because they are different user
 * ACTIONS — generate a new app-specific password versus correct the address —
 * and the connect form has to be able to say which.
 */
export class CalDavAuthError extends CalendarConnectError {
    constructor(message = 'Apple rejected that Apple ID or app-specific password.') {
        super(message);
        this.name = 'CalDavAuthError';
    }
}

/** The server answered, but there is no calendar home at that address. */
export class CalDavDiscoveryError extends CalendarConnectError {
    constructor(message = 'Could not find a calendar home at that address.') {
        super(message);
        this.name = 'CalDavDiscoveryError';
    }
}

/** A trailing slash makes relative-href resolution behave; add one if missing. */
function normalizeBase(url: string): string {
    const trimmed = url.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}

async function propfind(url: string, auth: DavAuth, body: string): Promise<string> {
    const res = await davFetch('PROPFIND', url, {
        auth, depth: '0', body, contentType: DAV_CONTENT_TYPE,
    });
    if (res.status === 401 || res.status === 403) throw new CalDavAuthError();
    if (!res.ok && res.status !== 207) {
        // No status text, no body: an upstream error page can echo back the
        // request, and the request carries the Basic header.
        logger.warn('[caldav] discovery PROPFIND failed', { status: res.status });
        throw new CalDavDiscoveryError();
    }
    return res.text();
}

/**
 * `current-user-principal`, then that principal's `calendar-home-set`.
 *
 * Two round trips rather than one because the principal path is per-account and
 * only the server knows it; guessing it is how a CalDAV client ends up working
 * for the developer's account and nobody else's.
 */
export async function discoverCalendarHome(p: {
    baseUrl: string;
    auth: DavAuth;
}): Promise<{ principalUrl: string; homeUrl: string }> {
    const base = normalizeBase(p.baseUrl || ICLOUD_CALDAV_BASE);

    const principalXml = await propfind(base, p.auth, PROPFIND_PRINCIPAL);
    const principalHref = firstHrefIn(
        parseMultistatus(principalXml)[0]?.props['current-user-principal'],
    );
    if (!principalHref) throw new CalDavDiscoveryError();
    const principalUrl = resolveHref(base, principalHref);

    const homeXml = await propfind(principalUrl, p.auth, PROPFIND_HOME_SET);
    const homeHref = firstHrefIn(
        parseMultistatus(homeXml)[0]?.props['calendar-home-set'],
    );
    if (!homeHref) throw new CalDavDiscoveryError();

    return { principalUrl, homeUrl: resolveHref(principalUrl, homeHref) };
}
