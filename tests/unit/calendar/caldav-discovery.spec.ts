/**
 * What we STORE is the calendar home the server named, not what the user typed.
 * What the user typed is a starting point: it may be a bare hostname, an Apple
 * ID URL, or nothing at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    discoverCalendarHome,
    CalDavAuthError,
    CalDavDiscoveryError,
    ICLOUD_CALDAV_BASE,
} from '../../../server/lib/calendar/caldav/discovery';

const AUTH = { username: 'inspector@icloud.com', password: 'abcd-efgh-ijkl-mnop' };

const PRINCIPAL_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop><d:current-user-principal><d:href>/1234567/principal/</d:href></d:current-user-principal></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const HOME_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/1234567/principal/</d:href>
    <d:propstat>
      <d:prop><c:calendar-home-set><d:href>https://p42-caldav.icloud.com/1234567/calendars/</d:href></c:calendar-home-set></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const NO_HOME_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/1234567/principal/</d:href>
    <d:propstat><d:prop><d:displayname>Someone</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

describe('discoverCalendarHome', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    function twoStep() {
        return vi.mocked(fetch)
            .mockResolvedValueOnce(new Response(PRINCIPAL_BODY, { status: 207 }))
            .mockResolvedValueOnce(new Response(HOME_BODY, { status: 207 }));
    }

    it('returns the home the SERVER named, never the address the user typed', async () => {
        const fetchMock = twoStep();
        const out = await discoverCalendarHome({ baseUrl: ICLOUD_CALDAV_BASE, auth: AUTH });

        expect(out.homeUrl).toBe('https://p42-caldav.icloud.com/1234567/calendars/');
        expect(out.homeUrl).not.toBe(ICLOUD_CALDAV_BASE);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('resolves a bare-path principal href against the base before the second PROPFIND', async () => {
        const fetchMock = twoStep();
        const out = await discoverCalendarHome({ baseUrl: ICLOUD_CALDAV_BASE, auth: AUTH });

        expect(out.principalUrl).toBe('https://caldav.icloud.com/1234567/principal/');
        expect(String(fetchMock.mock.calls[1]![0])).toBe('https://caldav.icloud.com/1234567/principal/');
    });

    it('treats a 401 as a credential problem the user can fix', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));
        await expect(discoverCalendarHome({ baseUrl: ICLOUD_CALDAV_BASE, auth: AUTH }))
            .rejects.toBeInstanceOf(CalDavAuthError);
    });

    /**
     * A reachable server with no calendar home behind it is a DIFFERENT user
     * action from a rejected password — a wrong address rather than a wrong
     * credential — and the connect form has to be able to say which.
     */
    it('treats a 200 with no calendar-home-set as structural, not as an auth failure', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(new Response(PRINCIPAL_BODY, { status: 207 }))
            .mockResolvedValueOnce(new Response(NO_HOME_BODY, { status: 207 }));

        const err = await discoverCalendarHome({ baseUrl: ICLOUD_CALDAV_BASE, auth: AUTH })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(CalDavDiscoveryError);
        expect(err).not.toBeInstanceOf(CalDavAuthError);
    });

    it('gives the same answer with and without a trailing slash on the typed URL', async () => {
        twoStep();
        const withSlash = await discoverCalendarHome({ baseUrl: 'https://caldav.icloud.com/', auth: AUTH });
        twoStep();
        const without = await discoverCalendarHome({ baseUrl: 'https://caldav.icloud.com', auth: AUTH });
        expect(withSlash).toEqual(without);
    });

    it('never puts the password in the error message', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));
        const err = await discoverCalendarHome({ baseUrl: ICLOUD_CALDAV_BASE, auth: AUTH })
            .catch((e: unknown) => e as Error);
        expect((err as Error).message).not.toContain(AUTH.password);
        expect((err as Error).message).not.toContain('Basic ');
    });
});
