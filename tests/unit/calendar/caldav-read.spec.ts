/**
 * The CalDAV read path: which collections count as calendars, and what a
 * time-bounded REPORT turns into.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appleCalendarProvider } from '../../../server/lib/calendar/caldav/apple';
import { filterImportableBlocks } from '../../../server/lib/calendar/google-import';
import type { CalendarAuth } from '../../../server/lib/calendar/provider';

const HOME = 'https://p42-caldav.icloud.com/1234567/calendars/';

const auth = {
    provider: 'apple',
    material: { username: 'i@icloud.com', password: 'pw', homeUrl: HOME },
} as CalendarAuth;

const CALENDARS_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/1234567/calendars/work/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Work</d:displayname>
      <d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/shared/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Shared</d:displayname>
      <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/tasks/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Reminders</d:displayname>
      <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/inbox/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype>
      <d:displayname>Inbox</d:displayname>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

const ics = (uid: string) => [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTART:20260714T140000Z',
    'DTEND:20260714T150000Z',
    'CREATED:20260701T000000Z',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

function reportBody(entries: Array<{ href: string; uid: string }>): string {
    const responses = entries.map((e) => `
  <d:response>
    <d:href>${e.href}</d:href>
    <d:propstat><d:prop>
      <d:getetag>"etag-${e.uid}"</d:getetag>
      <c:calendar-data>${ics(e.uid)}</c:calendar-data>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>`).join('');
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`;
}

const RANGE = {
    from: new Date('2026-07-14T00:00:00.000Z'),
    to: new Date('2026-08-13T00:00:00.000Z'),
};

describe('appleCalendarProvider.listCalendars', () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    it('keeps only VEVENT calendar collections and derives the access role', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(CALENDARS_BODY, { status: 207 }));

        const cals = await appleCalendarProvider.listCalendars({ auth });

        expect(cals.map((c) => c.summary)).toEqual(['Shared', 'Work']);
        expect(cals.find((c) => c.summary === 'Work')!.accessRole).toBe('writer');
        expect(cals.find((c) => c.summary === 'Shared')!.accessRole).toBe('reader');
    });

    /**
     * CalDAV has no "primary" calendar; `resolveReadSet` requires one. Exactly
     * one, and it must be writable, or the write target is a calendar we cannot
     * write to.
     */
    it('marks exactly one calendar primary — our choice, not the server\'s', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(CALENDARS_BODY, { status: 207 }));
        const cals = await appleCalendarProvider.listCalendars({ auth });
        const primary = cals.filter((c) => c.primary);
        expect(primary).toHaveLength(1);
        expect(primary[0]!.accessRole).toBe('writer');
    });

    it('sends a Depth: 1 PROPFIND against the discovered home', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(new Response(CALENDARS_BODY, { status: 207 }));
        await appleCalendarProvider.listCalendars({ auth });

        const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
        expect(String(url)).toBe(HOME);
        expect(init.method).toBe('PROPFIND');
        expect(new Headers(init.headers as HeadersInit).get('depth')).toBe('1');
    });
});

describe('appleCalendarProvider.listBusy', () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    it('REPORTs the requested window against the collection', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(new Response(reportBody([
            { href: '/1234567/calendars/work/abc.ics', uid: 'abc' },
        ]), { status: 207 }));

        await appleCalendarProvider.listBusy({
            auth, calendarId: '/1234567/calendars/work/', range: RANGE, capability: 'events_read_write',
        });

        const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
        expect(String(url)).toBe('https://p42-caldav.icloud.com/1234567/calendars/work/');
        expect(init.method).toBe('REPORT');
        expect(new Headers(init.headers as HeadersInit).get('depth')).toBe('1');
        expect(String(init.body)).toContain('start="20260714T000000Z"');
        expect(String(init.body)).toContain('end="20260813T000000Z"');
    });

    /**
     * The identifier is the RESOURCE HREF, not the UID: the href is what a
     * write has to address and what `listOwnExternalIds` compares against, and
     * one identifier used by both sides is the only way the
     * skip-events-OI-pushed-itself rule can work at all.
     */
    it('identifies each block by its resource href, not its UID', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(reportBody([
            { href: '/1234567/calendars/work/abc.ics', uid: 'the-uid' },
        ]), { status: 207 }));

        const blocks = await appleCalendarProvider.listBusy({
            auth, calendarId: '/1234567/calendars/work/', range: RANGE, capability: 'events_read_write',
        });

        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.externalId).toBe('/1234567/calendars/work/abc.ics');
        expect(blocks[0]!.externalId).not.toBe('the-uid');
        expect(blocks[0]!.start).toBe('2026-07-14T14:00:00.000Z');
    });

    /**
     * The rule that stops the calendar round-tripping has never run against a
     * non-Google identifier. If the read and the write disagreed about what an
     * external id IS, every event OI pushed would come back as busy time.
     */
    it('lets filterImportableBlocks recognise an OI-pushed CalDAV event by its href', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(reportBody([
            { href: '/1234567/calendars/work/ours.ics', uid: 'u1' },
            { href: '/1234567/calendars/work/theirs.ics', uid: 'u2' },
        ]), { status: 207 }));

        const blocks = await appleCalendarProvider.listBusy({
            auth, calendarId: '/1234567/calendars/work/', range: RANGE, capability: 'events_read_write',
        });

        const { keep, skipped } = filterImportableBlocks(blocks, {
            ownExternalIds: new Set(['/1234567/calendars/work/ours.ics']),
            connectedAtMs: Date.parse('2026-06-01T00:00:00Z'),
        });

        expect(skipped.oi_originated).toBe(1);
        expect(keep.map((b) => b.externalId)).toEqual(['/1234567/calendars/work/theirs.ics']);
    });
});
