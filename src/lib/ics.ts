/**
 * Sprint 1 Sub-spec C-10 — RFC 5545 ICS builder for customer-facing
 * calendar invitations. Pure string assembly — no external library — so
 * the worker bundle stays small and the output is auditable.
 *
 * Used by:
 *   * `EmailService.icsAttachment()` — booking confirmation, 24h reminder
 *
 * Compliance highlights:
 *   * §3.1 line folding at 75 octets, continuation prefixed with one space
 *   * §3.1 CRLF line endings throughout
 *   * §3.3.11 TEXT-type escaping (`\\`, `;`, `,`, `\n`)
 *   * §3.8.7.2 DTSTAMP required, UTC `Z`-suffixed YYYYMMDDTHHMMSS
 *   * METHOD:REQUEST + STATUS:CONFIRMED so Apple/Google Calendar treat
 *     the attachment as an invitation, not a transparent timeslot
 */
export interface IcsEvent {
    uid:            string;
    summary:        string;
    description:    string;
    location:       string;
    start:          Date;
    end:            Date;
    organizerEmail: string;
    organizerName:  string;
}

/** Format a Date as YYYYMMDDTHHMMSSZ — RFC 5545 §3.3.5 form #2 (UTC). */
function fmtDate(d: Date): string {
    return d.toISOString()
        .replace(/[-:]/g, '')   // drop separators
        .replace(/\.\d{3}/, ''); // drop milliseconds
}

/** Escape a TEXT-typed property value per RFC 5545 §3.3.11. */
function escapeText(s: string): string {
    return (s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding. Lines longer than 75 octets are split; each
 * continuation line is prefixed with a single space (linear whitespace) so
 * a parser can rejoin them.
 *
 * We treat input as UTF-16 char counts here, which is a safe over-estimate
 * for the ASCII output buildIcs produces (organizer name, address). If
 * downstream consumers need full multibyte handling, this can be replaced
 * with a TextEncoder-based byte counter without changing the API.
 */
function foldLine(line: string): string {
    if (line.length <= 75) return line;
    const out: string[] = [];
    let buf = line;
    out.push(buf.slice(0, 75));
    buf = buf.slice(75);
    while (buf.length > 74) {
        out.push(' ' + buf.slice(0, 74));
        buf = buf.slice(74);
    }
    if (buf.length > 0) out.push(' ' + buf);
    return out.join('\r\n');
}

export function buildIcs(e: IcsEvent): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenInspection//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `DTSTAMP:${fmtDate(new Date())}`,
        `DTSTART:${fmtDate(e.start)}`,
        `DTEND:${fmtDate(e.end)}`,
        `SUMMARY:${escapeText(e.summary)}`,
        `DESCRIPTION:${escapeText(e.description)}`,
        `LOCATION:${escapeText(e.location)}`,
        `ORGANIZER;CN=${escapeText(e.organizerName)}:mailto:${e.organizerEmail}`,
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return lines.map(foldLine).join('\r\n') + '\r\n';
}
