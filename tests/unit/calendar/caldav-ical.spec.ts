/**
 * iCalendar parsing, narrowed to what the busy import reads.
 *
 * Line UNFOLDING comes first, always: RFC 5545 folds at 75 octets, and a parser
 * that skips it silently truncates every long value. It is the single most
 * common iCalendar bug and it only shows up on real data.
 */
import { describe, it, expect } from 'vitest';
import { parseVEvents } from '../../../server/lib/calendar/caldav/ical';

// \r\n + a leading space is a continuation, not a new property.
const FOLDED = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:folded-1',
    'SUMMARY:Dentist appointment at 1 Main Street\\, Suite 400\\, Somew',
    ' here City',
    'DTSTART:20260610T140000Z',
    'DTEND:20260610T150000Z',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

const ALL_DAY = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:allday-1',
    'DTSTART;VALUE=DATE:20260610',
    'DTEND;VALUE=DATE:20260611',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

const ZONED = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:zoned-1',
    'DTSTART;TZID=America/New_York:20260610T100000',
    'DTEND;TZID=America/New_York:20260610T120000',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

const RICH = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:rich-1',
    'RECURRENCE-ID:20260610T140000Z',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'TRANSP:TRANSPARENT',
    'CREATED:20260501T000000Z',
    'LAST-MODIFIED:20260602T000000Z',
    'DTSTART:20260610T140000Z',
    'DTEND:20260610T150000Z',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VTODO',
    'UID:todo-1',
    'DTSTART:20260610T090000Z',
    'END:VTODO',
    'END:VCALENDAR',
].join('\r\n');

describe('parseVEvents', () => {
    it('unfolds continuation lines before reading a property', () => {
        const [event] = parseVEvents(FOLDED);
        expect(event!.uid).toBe('folded-1');
        expect(event!.summary).toBe('Dentist appointment at 1 Main Street, Suite 400, Somewhere City');
    });

    it('reads a bare UTC instant', () => {
        const [event] = parseVEvents(FOLDED);
        expect(event!.startMs).toBe(Date.parse('2026-06-10T14:00:00Z'));
        expect(event!.endMs).toBe(Date.parse('2026-06-10T15:00:00Z'));
        expect(event!.allDay).toBe(false);
    });

    it('reads VALUE=DATE as a whole-day range', () => {
        const [event] = parseVEvents(ALL_DAY);
        expect(event!.allDay).toBe(true);
        expect(event!.startMs).toBe(Date.parse('2026-06-10T00:00:00Z'));
        expect(event!.endMs).toBe(Date.parse('2026-06-11T00:00:00Z'));
    });

    it('resolves a TZID wall clock into the right instant', () => {
        const [event] = parseVEvents(ZONED);
        // 10:00 in America/New_York on 2026-06-10 is 14:00Z (EDT).
        expect(event!.startMs).toBe(Date.parse('2026-06-10T14:00:00Z'));
        expect(event!.endMs).toBe(Date.parse('2026-06-10T16:00:00Z'));
    });

    it('carries recurrence, transparency and the created/modified stamps', () => {
        const events = parseVEvents(RICH);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            uid: 'rich-1',
            recurrenceId: '20260610T140000Z',
            rrule: 'FREQ=WEEKLY;COUNT=4',
            transparent: true,
            createdMs: Date.parse('2026-05-01T00:00:00Z'),
            lastModifiedMs: Date.parse('2026-06-02T00:00:00Z'),
        });
    });

    it('ignores VTODO, VALARM and VTIMEZONE components', () => {
        expect(parseVEvents(RICH).map((e) => e.uid)).toEqual(['rich-1']);
        expect(parseVEvents(ZONED).map((e) => e.uid)).toEqual(['zoned-1']);
    });

    it('returns [] rather than throwing on junk', () => {
        expect(parseVEvents('')).toEqual([]);
        expect(parseVEvents('BEGIN:VEVENT\r\nUID:no-dates\r\nEND:VEVENT')).toEqual([]);
    });
});
