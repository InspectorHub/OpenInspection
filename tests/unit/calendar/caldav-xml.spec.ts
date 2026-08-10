/**
 * The CalDAV bodies we send never vary, and the ones we receive come from
 * servers we do not control. So: fixed request strings, and a DEFENSIVE parse
 * that returns nothing rather than throwing on anything it does not recognise.
 * No XML dependency — a general DOM is far more than four fixed bodies and one
 * multistatus shape need.
 */
import { describe, it, expect } from 'vitest';
import {
    PROPFIND_PRINCIPAL,
    PROPFIND_HOME_SET,
    PROPFIND_CALENDARS,
    buildCalendarQuery,
    buildSyncCollection,
    parseMultistatus,
    firstHrefIn,
    hasElement,
} from '../../../server/lib/calendar/caldav/xml';

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop><d:current-user-principal><d:href>/1234567/principal/</d:href></d:current-user-principal></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

// Case of the namespace prefix differs by server; both mean DAV:.
const HOME_SET_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/1234567/principal/</D:href>
    <D:propstat>
      <D:prop><C:calendar-home-set><D:href>https://p42-caldav.icloud.com/1234567/calendars/</D:href></C:calendar-home-set></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

const CALENDAR_LIST_BODY = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/1234567/calendars/home/</href>
    <propstat>
      <prop>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <displayname>Work &amp; Play</displayname>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234567/calendars/inbox/</href>
    <propstat>
      <prop>
        <resourcetype><collection/><C:schedule-inbox/></resourcetype>
        <displayname>Inbox</displayname>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

const MIXED_PROPSTAT_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/1234567/calendars/home/</d:href>
    <d:propstat>
      <d:prop><d:displayname>Home</d:displayname></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><d:getetag/><d:not-a-real-prop/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('CalDAV request bodies', () => {
    it('ships three fixed PROPFIND bodies', () => {
        for (const body of [PROPFIND_PRINCIPAL, PROPFIND_HOME_SET, PROPFIND_CALENDARS]) {
            expect(body.startsWith('<?xml')).toBe(true);
            expect(body).toContain('propfind');
        }
        expect(PROPFIND_PRINCIPAL).toContain('current-user-principal');
        expect(PROPFIND_HOME_SET).toContain('calendar-home-set');
        expect(PROPFIND_CALENDARS).toContain('supported-calendar-component-set');
    });

    it('interpolates only UTC timestamps into the calendar-query', () => {
        const body = buildCalendarQuery({
            from: new Date('2026-07-14T00:00:00.000Z'),
            to: new Date('2026-08-13T00:00:00.000Z'),
        });
        expect(body).toContain('start="20260714T000000Z"');
        expect(body).toContain('end="20260813T000000Z"');
        expect(body).toContain('VEVENT');
    });

    it('omits the sync-token element on a first run and escapes it otherwise', () => {
        expect(buildSyncCollection(null)).toContain('<d:sync-token/>');
        const withToken = buildSyncCollection('data:,1234"&<>');
        expect(withToken).toContain('&quot;&amp;&lt;&gt;');
        expect(withToken).not.toContain('1234"&<>');
    });
});

describe('parseMultistatus', () => {
    it('reads a lowercase d: prefixed principal response', () => {
        const rows = parseMultistatus(PRINCIPAL_BODY);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.href).toBe('/');
        expect(rows[0]!.status).toBe(200);
        expect(firstHrefIn(rows[0]!.props['current-user-principal'])).toBe('/1234567/principal/');
    });

    it('reads an uppercase D: prefixed home-set response — the prefix is not the name', () => {
        const rows = parseMultistatus(HOME_SET_BODY);
        expect(firstHrefIn(rows[0]!.props['calendar-home-set']))
            .toBe('https://p42-caldav.icloud.com/1234567/calendars/');
    });

    it('exposes resourcetype and component set so a non-calendar collection can be dropped', () => {
        const rows = parseMultistatus(CALENDAR_LIST_BODY);
        expect(rows).toHaveLength(2);
        const calendars = rows.filter((r) => hasElement(r.props.resourcetype, 'calendar'));
        expect(calendars.map((r) => r.href)).toEqual(['/1234567/calendars/home/']);
        expect(calendars[0]!.props.displayname).toBe('Work & Play');
        expect(rows[1]!.props.displayname).toBe('Inbox');
    });

    it('drops props from a 404 propstat inside an otherwise-200 response', () => {
        const rows = parseMultistatus(MIXED_PROPSTAT_BODY);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.props.displayname).toBe('Home');
        expect(rows[0]!.props.getetag).toBeUndefined();
        expect(rows[0]!.status).toBe(200);
    });

    it('returns [] rather than throwing on truncated XML', () => {
        expect(parseMultistatus('<d:multistatus><d:response><d:href>/a/</d:hre')).toEqual([]);
        expect(parseMultistatus('')).toEqual([]);
        expect(parseMultistatus('not xml at all')).toEqual([]);
    });

    it('decodes the five XML entities and unwraps CDATA in a display name', () => {
        const body = `<multistatus xmlns="DAV:"><response><href>/c/</href><propstat>`
            + `<prop><displayname>Jo&apos;s &quot;Big&quot; &lt;Cal&gt; &amp; Co</displayname></prop>`
            + `<status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
        expect(parseMultistatus(body)[0]!.props.displayname).toBe('Jo\'s "Big" <Cal> & Co');

        const cdata = `<multistatus xmlns="DAV:"><response><href>/c/</href><propstat>`
            + `<prop><displayname><![CDATA[Raw & <unescaped>]]></displayname></prop>`
            + `<status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
        expect(parseMultistatus(cdata)[0]!.props.displayname).toBe('Raw & <unescaped>');
    });
});
