/**
 * Sprint 1 Sub-spec C-10 — TDD spec for the customer-side ICS builder.
 *
 * `buildIcs()` is a pure RFC 5545 string-assembly helper used by the
 * booking confirmation + 24h reminder emails. It MUST:
 *   * produce a valid VCALENDAR / VEVENT block parseable by Apple
 *     Calendar / Google Calendar
 *   * escape commas, semicolons, backslashes, newlines per RFC 5545 §3.3.11
 *   * fold lines longer than 75 octets per RFC 5545 §3.1
 *   * use UTC `Z`-suffixed timestamps without milliseconds
 *   * emit CRLF line endings (RFC 5545 §3.1)
 *
 * No external library — implementation is local to `server/lib/ics.ts`.
 */
import { describe, it, expect } from 'vitest';
import { buildIcs } from '../../../server/lib/ics';

describe('buildIcs RFC 5545 compliance', () => {
    it('produces a valid VCALENDAR / VEVENT block', () => {
        const ics = buildIcs({
            uid:            'inspection-abc-2026',
            summary:        'Home Inspection at 1234 Oak St',
            description:    'Inspector: Jason Zheng (555-1234)\nReport will be delivered within 24h.',
            location:       '1234 Oak St, Austin, TX 78701',
            start:          new Date('2026-05-20T13:00:00Z'),
            end:            new Date('2026-05-20T16:00:00Z'),
            organizerEmail: 'jason@inspectorco.com',
            organizerName:  'Jason Zheng',
        });

        expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
        expect(ics).toMatch(/VERSION:2\.0/);
        expect(ics).toMatch(/PRODID:-\/\/OpenInspection/);
        expect(ics).toMatch(/UID:inspection-abc-2026/);
        expect(ics).toMatch(/DTSTART:20260520T130000Z/);
        expect(ics).toMatch(/DTEND:20260520T160000Z/);
        expect(ics).toMatch(/SUMMARY:Home Inspection at 1234 Oak St/);
        expect(ics).toMatch(/LOCATION:1234 Oak St\\, Austin\\, TX 78701/);
        expect(ics).toMatch(/ORGANIZER;CN=Jason Zheng:mailto:jason@inspectorco\.com/);
        expect(ics).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/);
    });

    it('escapes commas, semicolons, newlines, and backslashes in text fields', () => {
        const ics = buildIcs({
            uid:            'x',
            summary:        'A, B; C\nD\\E',
            description:    'line1\nline2',
            location:       '',
            start:          new Date('2026-01-01T00:00:00Z'),
            end:            new Date('2026-01-01T01:00:00Z'),
            organizerEmail: 'a@b.com',
            organizerName:  'X',
        });
        expect(ics).toContain('SUMMARY:A\\, B\\; C\\nD\\\\E');
        expect(ics).toContain('DESCRIPTION:line1\\nline2');
    });

    it('emits CRLF line endings only (no bare LF)', () => {
        const ics = buildIcs({
            uid:            'x',
            summary:        's',
            description:    'd',
            location:       'l',
            start:          new Date('2026-01-01T00:00:00Z'),
            end:            new Date('2026-01-01T01:00:00Z'),
            organizerEmail: 'a@b.com',
            organizerName:  'X',
        });
        // No bare \n that is not preceded by \r.
        expect(/(?<!\r)\n/.test(ics)).toBe(false);
    });

    it('emits a DTSTAMP property (required by RFC 5545)', () => {
        const ics = buildIcs({
            uid:            'x',
            summary:        's',
            description:    'd',
            location:       'l',
            start:          new Date('2026-01-01T00:00:00Z'),
            end:            new Date('2026-01-01T01:00:00Z'),
            organizerEmail: 'a@b.com',
            organizerName:  'X',
        });
        expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    });

    it('strips milliseconds from DTSTART/DTEND', () => {
        const ics = buildIcs({
            uid:            'x',
            summary:        's',
            description:    'd',
            location:       'l',
            start:          new Date('2026-05-20T13:00:00.123Z'),
            end:            new Date('2026-05-20T16:00:00.999Z'),
            organizerEmail: 'a@b.com',
            organizerName:  'X',
        });
        expect(ics).toContain('DTSTART:20260520T130000Z');
        expect(ics).toContain('DTEND:20260520T160000Z');
        // No millisecond fraction inside any DT* property line.
        const dtLines = ics.split('\r\n').filter(l => /^DT(START|END|STAMP):/.test(l));
        for (const ln of dtLines) {
            expect(ln).not.toMatch(/\.\d/);
        }
    });

    it('folds lines longer than 75 octets per RFC 5545 §3.1', () => {
        // Single 200-char description -> the resulting DESCRIPTION line is
        // > 75 octets, must wrap with CRLF + leading space on continuations.
        const longDesc = 'X'.repeat(200);
        const ics = buildIcs({
            uid:            'long',
            summary:        's',
            description:    longDesc,
            location:       'l',
            start:          new Date('2026-01-01T00:00:00Z'),
            end:            new Date('2026-01-01T01:00:00Z'),
            organizerEmail: 'a@b.com',
            organizerName:  'X',
        });
        // After folding, no single line should exceed 75 chars (we use chars
        // as a proxy for octets; the helper handles ASCII only here).
        const lines = ics.split('\r\n');
        for (const ln of lines) {
            expect(ln.length).toBeLessThanOrEqual(75);
        }
        // The folded continuation must start with a single space.
        const idx = lines.findIndex(l => l.startsWith('DESCRIPTION:'));
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(lines[idx + 1]?.startsWith(' ')).toBe(true);
    });

    it('includes METHOD:REQUEST so calendar clients treat it as an invitation', () => {
        const ics = buildIcs({
            uid:            'x',
            summary:        's',
            description:    'd',
            location:       'l',
            start:          new Date('2026-01-01T00:00:00Z'),
            end:            new Date('2026-01-01T01:00:00Z'),
            organizerEmail: 'a@b.com',
            organizerName:  'X',
        });
        expect(ics).toContain('METHOD:REQUEST');
        expect(ics).toContain('STATUS:CONFIRMED');
    });
});
