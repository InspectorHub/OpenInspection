/**
 * The CalDAV HTTP layer. It returns the raw `Response` on purpose: 404 means
 * "gone" on a write and "no such collection" on a read, and one function cannot
 * mean both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { davFetch, resolveHref } from '../../../server/lib/calendar/caldav/client';

const AUTH = { username: 'inspector@icloud.com', password: 'abcd-efgh' };

describe('davFetch', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    function headersOf(call: unknown[]): Headers {
        return new Headers(((call[1] ?? {}) as RequestInit).headers as HeadersInit | undefined);
    }

    it('sends Basic auth, Depth and Content-Type on a PROPFIND', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(new Response('<multistatus/>', { status: 207 }));

        const res = await davFetch('PROPFIND', 'https://caldav.icloud.com/', {
            auth: AUTH, depth: '0', body: '<propfind/>', contentType: 'application/xml; charset=utf-8',
        });

        expect(res.status).toBe(207);
        const call = fetchMock.mock.calls[0]!;
        expect(String(call[0])).toBe('https://caldav.icloud.com/');
        expect(((call[1] ?? {}) as RequestInit).method).toBe('PROPFIND');
        const headers = headersOf(call);
        expect(headers.get('authorization')).toBe(`Basic ${btoa('inspector@icloud.com:abcd-efgh')}`);
        expect(headers.get('depth')).toBe('0');
        expect(headers.get('content-type')).toBe('application/xml; charset=utf-8');
        expect(headers.get('user-agent')).toBeTruthy();
    });

    /**
     * Only the FIRST colon separates user from password in a Basic credential,
     * so a password containing one must survive intact.
     */
    it('builds a correct Basic header for a password containing a colon', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));
        await davFetch('GET', 'https://caldav.icloud.com/x', {
            auth: { username: 'a@b.com', password: 'pa:ss:word' },
        });
        const header = headersOf(vi.mocked(fetch).mock.calls[0]!).get('authorization')!;
        const decoded = atob(header.replace('Basic ', ''));
        expect(decoded).toBe('a@b.com:pa:ss:word');
        expect(decoded.slice(decoded.indexOf(':') + 1)).toBe('pa:ss:word');
    });

    it('sends If-Match and If-None-Match only when asked', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValue(new Response('', { status: 201 }));

        await davFetch('PUT', 'https://c/1.ics', { auth: AUTH, body: 'BEGIN:VCALENDAR', ifNoneMatch: '*' });
        expect(headersOf(fetchMock.mock.calls[0]!).get('if-none-match')).toBe('*');
        expect(headersOf(fetchMock.mock.calls[0]!).get('if-match')).toBeNull();

        await davFetch('PUT', 'https://c/1.ics', { auth: AUTH, body: 'BEGIN:VCALENDAR', ifMatch: '"etag-1"' });
        expect(headersOf(fetchMock.mock.calls[1]!).get('if-match')).toBe('"etag-1"');
    });

    it('does not interpret the status — a 404 comes back as a 404', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
        const res = await davFetch('DELETE', 'https://c/1.ics', { auth: AUTH });
        expect(res.status).toBe(404);
    });
});

/**
 * multistatus hrefs are usually absolute PATHS and occasionally absolute URLs.
 * Resolving against the collection is not optional; skipping it produces
 * requests to the wrong origin that fail in a way that reads like bad auth.
 */
describe('resolveHref', () => {
    it('resolves a bare absolute path against the base origin', () => {
        expect(resolveHref('https://p42-caldav.icloud.com/123/calendars/', '/123/calendars/home/'))
            .toBe('https://p42-caldav.icloud.com/123/calendars/home/');
    });

    it('passes a full URL through unchanged', () => {
        expect(resolveHref('https://caldav.icloud.com/', 'https://p42-caldav.icloud.com/123/calendars/'))
            .toBe('https://p42-caldav.icloud.com/123/calendars/');
    });

    it('resolves a relative segment against the collection, not the origin', () => {
        expect(resolveHref('https://p42-caldav.icloud.com/123/calendars/', 'home/'))
            .toBe('https://p42-caldav.icloud.com/123/calendars/home/');
    });
});
