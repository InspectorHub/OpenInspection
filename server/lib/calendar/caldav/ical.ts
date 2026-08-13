/**
 * iCalendar (RFC 5545), narrowed to what the busy import reads.
 *
 * Deliberately not a general parser: it reads a handful of properties off
 * VEVENT components and ignores everything else. What it will NOT skip is line
 * UNFOLDING — RFC 5545 folds at 75 octets, and a parser that reads raw lines
 * silently truncates every long value. That is the single most common
 * iCalendar bug and it only ever shows up on real data.
 */
import { wallClockToEpochMs } from '../../tz';

export interface ParsedVEvent {
    uid: string;
    summary?: string;
    startMs: number;
    endMs: number;
    allDay: boolean;
    transparent: boolean;
    /** Present on one instance of a recurring series. */
    recurrenceId?: string;
    /** Present on the series master. */
    rrule?: string;
    createdMs?: number;
    lastModifiedMs?: number;
}

interface ContentLine {
    name: string;
    params: Record<string, string>;
    value: string;
}

/**
 * Join folded continuations back onto their property.
 *
 * A CRLF (or bare LF, which servers do emit) followed by a SPACE or TAB is a
 * continuation of the previous line, and the whitespace itself is not part of
 * the value.
 */
function unfold(text: string): string[] {
    return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

/** `DTSTART;TZID=America/New_York:20260610T100000` -> name/params/value. */
function parseLine(line: string): ContentLine | null {
    const colon = line.indexOf(':');
    if (colon === -1) return null;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = head.split(';');
    const params: Record<string, string> = {};
    for (const part of paramParts) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: (name ?? '').toUpperCase(), params, value };
}

/** The four escapes RFC 5545 defines for TEXT values. */
function unescapeText(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

/**
 * A date-time in whichever of the three forms it arrived:
 *   `20260610`                       — VALUE=DATE, a whole day
 *   `20260610T140000Z`               — a UTC instant
 *   `20260610T100000` + TZID=…       — a wall clock in a named zone
 *
 * A wall clock with no TZID is "floating" and has no single instant; treating
 * it as UTC is the conventional fallback and is noted rather than hidden.
 */
function toEpochMs(line: ContentLine): number | null {
    const raw = line.value.trim();
    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (dateOnly) {
        return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    }
    const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
    if (!stamp) return null;
    const [, y, mo, d, h, mi, s, utc] = stamp;
    if (utc) {
        return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    }
    const tzid = line.params.TZID;
    if (!tzid) {
        return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    }
    return wallClockToEpochMs(`${y}-${mo}-${d}`, `${h}:${mi}`, tzid);
}

/** The VEVENT bodies in one ICS text, with nested components stripped. */
function veventBodies(lines: string[]): string[][] {
    const out: string[][] = [];
    let current: string[] | null = null;
    let nested = 0;
    for (const line of lines) {
        const upper = line.toUpperCase();
        if (upper === 'BEGIN:VEVENT') { current = []; nested = 0; continue; }
        if (upper === 'END:VEVENT') {
            if (current) out.push(current);
            current = null;
            continue;
        }
        if (!current) continue;   // VTODO / VTIMEZONE / VFREEBUSY — not ours
        // VALARM lives INSIDE a VEVENT and carries its own DTSTART/TRIGGER.
        if (upper.startsWith('BEGIN:')) { nested++; continue; }
        if (upper.startsWith('END:')) { if (nested > 0) nested--; continue; }
        if (nested === 0) current.push(line);
    }
    return out;
}

export function parseVEvents(icsText: string): ParsedVEvent[] {
    if (!icsText) return [];
    const events: ParsedVEvent[] = [];
    for (const body of veventBodies(unfold(icsText))) {
        const props = new Map<string, ContentLine>();
        for (const raw of body) {
            const line = parseLine(raw);
            if (line) props.set(line.name, line);
        }

        const uid = props.get('UID')?.value.trim();
        const dtstart = props.get('DTSTART');
        if (!uid || !dtstart) continue;

        const startMs = toEpochMs(dtstart);
        if (startMs == null) continue;

        const allDay = dtstart.params.VALUE?.toUpperCase() === 'DATE'
            || /^\d{8}$/.test(dtstart.value.trim());

        const dtend = props.get('DTEND');
        let endMs = dtend ? toEpochMs(dtend) : null;
        if (endMs == null) {
            // No DTEND: a dated event spans one day, a timed one is a point.
            endMs = allDay ? startMs + 24 * 60 * 60 * 1000 : startMs;
        }

        const created = props.get('CREATED');
        const modified = props.get('LAST-MODIFIED');
        const createdMs = created ? toEpochMs(created) : null;
        const lastModifiedMs = modified ? toEpochMs(modified) : null;

        events.push({
            uid,
            ...(props.has('SUMMARY') ? { summary: unescapeText(props.get('SUMMARY')!.value) } : {}),
            startMs,
            endMs,
            allDay,
            transparent: props.get('TRANSP')?.value.trim().toUpperCase() === 'TRANSPARENT',
            ...(props.has('RECURRENCE-ID') ? { recurrenceId: props.get('RECURRENCE-ID')!.value.trim() } : {}),
            ...(props.has('RRULE') ? { rrule: props.get('RRULE')!.value.trim() } : {}),
            ...(createdMs != null ? { createdMs } : {}),
            ...(lastModifiedMs != null ? { lastModifiedMs } : {}),
        });
    }
    return events;
}
