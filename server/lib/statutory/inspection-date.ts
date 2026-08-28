/**
 * A calendar day becomes the instant a statutory form revision is chosen from.
 *
 * `inspections.date` is calendar TEXT with no time and no zone; the version
 * selector takes epoch milliseconds. Something has to bridge those, and the
 * bridge picks a timezone whether anybody decides to or not. Getting it wrong
 * is the number-one failure mode of this subsystem, and it is invisible: on a
 * cutover day it selects the superseded revision of a state form, which is
 * still a real official document and still renders perfectly.
 *
 * -- WHY UTC, AND NOT THE WORKSPACE'S TIMEZONE -------------------------------
 * The inspection date is a fact that already happened. Which revision of an
 * authority's form governs it must not change afterwards, and a workspace
 * timezone is a SETTING -- somebody can edit it, and a tenant that moved from
 * `America/Chicago` to `Asia/Shanghai` would otherwise re-decide, retroactively,
 * which document every past inspection on a cutover day should have used. A
 * regenerated form would then differ from the one already delivered, with no
 * record of why. UTC is not more correct about local noon; it is fixed, and
 * fixed is the property this needs.
 *
 * -- WHAT UTC COSTS, STATED RATHER THAN DISCOVERED ---------------------------
 * The changeover therefore happens at 00:00 UTC, which in a UTC+ zone is during
 * the previous local afternoon or evening, and in a UTC- zone is during the
 * previous local evening or night. An inspection carried out on the cutover day
 * itself is unaffected -- it carries that calendar day and gets that day's
 * revision -- because the calendar day, not the clock, is what is stored. The
 * cost only lands if some future caller passes a real timestamp instead of a
 * calendar day, which is why this function refuses anything that is not
 * `YYYY-MM-DD`.
 *
 * -- WHY NOT `new Date(str)` -------------------------------------------------
 * It does not refuse a day that does not exist. `new Date('2026-02-30')` rolls
 * silently to March 2nd, and a rolled date can cross a cutover -- turning a
 * typo in one row into the wrong official document, with nothing logged. So the
 * three parts are parsed by hand and then READ BACK off the constructed date; a
 * value that did not survive the round trip was never a real day.
 */

/**
 * Every value this returns is an exact multiple of 86,400,000 -- one UTC day --
 * because that is what UTC midnight means. `check-statutory-fidelity.mjs` uses
 * the same arithmetic from the other side, to catch a published version whose
 * dates were built in local time. The constant is not shared: a second module
 * importing it would make this one look like the owner of a rule the gate
 * enforces independently, and the gate has to keep working on a tree where this
 * file has moved.
 */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(reason: string): never {
    throw new Error(`statutory inspection date: ${reason}`);
}

/**
 * Convert a `YYYY-MM-DD` calendar day to UTC midnight of that day.
 *
 * @param calendarDay exactly `YYYY-MM-DD`, zero-padded. `2026-4-1` is refused:
 *   accepting it would mean accepting whatever else a lenient parser accepts.
 * @returns epoch milliseconds, always an exact multiple of `MS_PER_UTC_DAY`.
 */
export function utcMidnightOf(calendarDay: string): number {
    const parts = CALENDAR_DAY.exec(calendarDay);
    if (!parts) {
        fail(`"${calendarDay}" is not a YYYY-MM-DD calendar day`);
    }
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);

    const asMs = Date.UTC(year, month - 1, day);
    const round = new Date(asMs);
    // The round trip is the check. A day that does not exist rolls into the
    // next month here, and the rolled value will not match what was asked for.
    if (
        round.getUTCFullYear() !== year
        || round.getUTCMonth() !== month - 1
        || round.getUTCDate() !== day
    ) {
        fail(`"${calendarDay}" is not a day that exists`);
    }
    return asMs;
}
