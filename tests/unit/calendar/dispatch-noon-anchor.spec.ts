/**
 * The dispatch board turns a dropped wall-clock minute into an instant on the CLIENT, counting from the `noonMs` the feed
 * ships. The server's `wallClockToEpochMs` is the authority for what a wall-clock time means in a zone. These two must
 * agree for every minute of the working axis, on ordinary days AND on the days the clock changes, in zones whose change
 * is not the New York one (30-minute shifts, a 45-minute offset, southern-hemisphere dates).
 *
 * Fixed dates, so the result does not depend on the day the suite runs (the e2e drag test only meets a change day on the
 * day itself).
 */
import { describe, expect, it } from 'vitest';
import { wallClockToEpochMs } from '../../../server/lib/tz';
import { BOARD_END_HOUR, BOARD_START_HOUR, minuteToEpochMs } from '../../../app/components/dispatch/dispatch-helpers';

const CASES: ReadonlyArray<readonly [zone: string, label: string, date: string]> = [
    ['America/New_York', 'ordinary day', '2026-06-01'],
    ['America/New_York', 'clock goes back (25 h)', '2026-11-01'],
    ['America/New_York', 'clock goes forward (23 h)', '2027-03-14'],
    ['Europe/London', 'clock goes back', '2026-10-25'],
    ['Europe/London', 'clock goes forward', '2027-03-28'],
    ['Pacific/Auckland', 'clock goes forward', '2026-09-27'],
    ['Pacific/Auckland', 'clock goes back', '2027-04-04'],
    ['Australia/Lord_Howe', 'a 30-minute shift forward', '2026-10-04'],
    ['Australia/Lord_Howe', 'a 30-minute shift back', '2027-04-04'],
    ['Pacific/Chatham', 'a +12:45 zone, clock goes forward', '2026-09-27'],
    ['America/Los_Angeles', 'clock goes back', '2026-11-01'],
];

describe('the board counts from noon exactly as the server reads a wall-clock time', () => {
    it.each(CASES)('%s, %s (%s): every quarter hour of the working axis agrees', (zone, _label, date) => {
        const noonMs = wallClockToEpochMs(date, '12:00', zone);
        let checked = 0;
        for (let minute = BOARD_START_HOUR * 60; minute < BOARD_END_HOUR * 60; minute += 15) {
            const hm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
            expect(minuteToEpochMs({ noonMs }, minute), `${zone} ${date} ${hm}`).toBe(wallClockToEpochMs(date, hm, zone));
            checked++;
        }
        // Positive control: the loop really ran over the whole axis (12 h of quarter hours).
        expect(checked).toBe((BOARD_END_HOUR - BOARD_START_HOUR) * 4);
    });

    it('control: counting from MIDNIGHT is wrong on a change day (this is what the board used to do)', () => {
        const dayStartMs = wallClockToEpochMs('2026-11-01', '00:00', 'America/New_York');
        const fromMidnight = dayStartMs + 9 * 60 * 60_000;
        expect(fromMidnight).not.toBe(wallClockToEpochMs('2026-11-01', '09:00', 'America/New_York'));
    });
});
