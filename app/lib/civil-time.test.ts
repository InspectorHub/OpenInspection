// @vitest-environment node
/**
 * The New Inspection wizard collects a civil date and a civil time — "2026-07-15",
 * "09:00" — and combined them as `${date}T${time}:00Z`, which declares the typed
 * time to be 09:00 UTC. An inspector types the hour they intend to arrive, in the
 * workspace's zone; nobody types UTC. So a workspace in America/New_York booked
 * for 9am stored 05:00 local and rendered that back, and the error was exactly the
 * zone's offset — invisible for a UTC tenant, four or eight hours for everyone else.
 *
 * These cases pin the conversion, including the two days a year it is genuinely
 * ambiguous. DST is where a naive offset calculation quietly fails, so the spring
 * gap and the autumn overlap are here by name.
 */
import { describe, it, expect } from 'vitest';
import { civilToInstantISO, todayInZone } from './civil-time';

describe('civilToInstantISO', () => {
    it('reads the typed time as a wall clock in the given zone', () => {
        // 09:00 in New York in July is EDT (UTC-4) → 13:00Z.
        expect(civilToInstantISO('2026-07-15', '09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z');
        // The same wall clock in January is EST (UTC-5) → 14:00Z. One zone, two
        // offsets: this is why the offset cannot be captured once and reused.
        expect(civilToInstantISO('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
    });

    it('handles zones ahead of UTC, where the instant lands on the previous day', () => {
        // 09:00 in Shanghai is UTC+8 → 01:00Z the same morning.
        expect(civilToInstantISO('2026-07-15', '09:00', 'Asia/Shanghai')).toBe('2026-07-15T01:00:00.000Z');
        // 07:00 in Shanghai is 23:00Z the day BEFORE — the case a same-day
        // assumption gets wrong.
        expect(civilToInstantISO('2026-07-15', '07:00', 'Asia/Shanghai')).toBe('2026-07-14T23:00:00.000Z');
    });

    it('is the identity for UTC, which is what the old code assumed for everyone', () => {
        expect(civilToInstantISO('2026-07-15', '09:00', 'UTC')).toBe('2026-07-15T09:00:00.000Z');
    });

    it('resolves the autumn overlap to the first of the two matching instants', () => {
        // 2026-11-01 01:30 happens twice in New York (EDT then EST). Either answer
        // is defensible; picking the earlier one deterministically is what matters,
        // so a booking never depends on which way an implementation drifted.
        expect(civilToInstantISO('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    });

    it('resolves the spring gap forward, to a time that exists', () => {
        // 2026-03-08 02:30 never happens in New York — the clock jumps 02:00 → 03:00.
        // The result must still be a real instant rather than NaN.
        const iso = civilToInstantISO('2026-03-08', '02:30', 'America/New_York');
        expect(Number.isNaN(Date.parse(iso))).toBe(false);
        expect(iso).toBe('2026-03-08T07:30:00.000Z');
    });

    it('falls back to UTC when the zone is blank or unknown rather than throwing', () => {
        // A tenant with no configured zone must still be able to book.
        expect(civilToInstantISO('2026-07-15', '09:00', '')).toBe('2026-07-15T09:00:00.000Z');
        expect(civilToInstantISO('2026-07-15', '09:00', 'Not/AZone')).toBe('2026-07-15T09:00:00.000Z');
    });

    it('returns empty for an incomplete pair, so a half-filled form submits nothing', () => {
        expect(civilToInstantISO('', '09:00', 'UTC')).toBe('');
        expect(civilToInstantISO('2026-07-15', '', 'UTC')).toBe('');
    });
});

/**
 * The date half of the same pair. The wizard read the typed TIME in one zone
 * while defaulting the DATE from another, and nobody had to touch a control for
 * the two to disagree — for a third of every day the browser's calendar day and
 * a UTC day are different dates.
 *
 * Both transitions are here in one zone because "today" is computed from an
 * offset, and an offset captured once is right for half the year.
 */
describe('todayInZone', () => {
    const PACIFIC = 'America/Los_Angeles';

    it('answers the day in that zone, not the UTC day', () => {
        // 19:30 Pacific on the 4th; UTC has already rolled to the 5th.
        const at = new Date('2026-11-05T03:30:00.000Z');
        expect(todayInZone(PACIFIC, at)).toBe('2026-11-04');
        expect(todayInZone('UTC', at)).toBe('2026-11-05');
        // And east of Greenwich the same instant is already the 5th locally.
        expect(todayInZone('Asia/Shanghai', at)).toBe('2026-11-05');
    });

    it('follows the zone across the autumn fall-back', () => {
        // PDT (-07:00) the Friday before...
        expect(todayInZone(PACIFIC, new Date('2026-10-31T06:30:00.000Z'))).toBe('2026-10-30');
        // ...PST (-08:00) the Friday after. A captured -07:00 reads this as the 7th.
        expect(todayInZone(PACIFIC, new Date('2026-11-07T07:30:00.000Z'))).toBe('2026-11-06');
    });

    it('follows the zone across the spring forward', () => {
        // PST (-08:00) before the jump...
        expect(todayInZone(PACIFIC, new Date('2027-03-13T07:30:00.000Z'))).toBe('2027-03-12');
        // ...PDT (-07:00) after it, where the local day has already turned over.
        // A captured -08:00 reads this as the 19th.
        expect(todayInZone(PACIFIC, new Date('2027-03-20T07:30:00.000Z'))).toBe('2027-03-20');
    });

    it('falls back to the day in the local environment for an unusable zone', () => {
        // Not a UTC day: a UTC day is already tomorrow for a third of the planet.
        const at = new Date('2026-11-05T03:30:00.000Z');
        const pad = (n: number) => String(n).padStart(2, '0');
        const envDay = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
        expect(todayInZone('', at)).toBe(envDay);
        expect(todayInZone('Not/AZone', at)).toBe(envDay);
    });
});
