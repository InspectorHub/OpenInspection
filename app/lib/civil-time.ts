/**
 * Civil (wall-clock) date + time → the UTC instant it names in a given zone.
 *
 * Forms collect what a person reads off a clock: "2026-07-15", "09:00". That pair
 * is not an instant until you say whose clock. The New Inspection wizard used to
 * combine them as `${date}T${time}:00Z`, which declares the typed time to be UTC —
 * so a workspace in America/New_York booked for 9am stored 05:00 local, wrong by
 * exactly the zone's offset and invisible to anyone testing from UTC.
 *
 * The conversion has no library behind it: guess that the civil time is UTC, ask
 * Intl what that instant reads as in the target zone, and correct by the difference.
 * One correction is exact wherever the offset is the same on both sides of it. On
 * the two days a year it is not, correcting a second time does not refine the
 * answer — it lands on the other side of the transition — so both candidates are
 * kept and chosen between explicitly. See civilToInstantISO.
 */

/** Read an instant's civil fields in a zone, as epoch ms of that wall clock read as UTC. */
function civilFieldsAsUtcMs(instantMs: number, timeZone: string): number {
    // This formatter produces no user-facing text — it exists to read back numeric
    // date parts, which are then parsed with Number(). The viewer's locale would be
    // actively wrong here: numbering systems such as ar-EG render Arabic-Indic
    // digits, and every field would come back NaN.
    // i18n-lint-ok: machine-readable parts, never displayed
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(new Date(instantMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // `hour: '2-digit'` with hour12:false renders midnight as 24 in some ICU
    // versions; normalise so the arithmetic below cannot drift by a day.
    const hour = get('hour') % 24;
    return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

function isUsableZone(timeZone: string): boolean {
    if (!timeZone) return false;
    try {
        // i18n-lint-ok: a validity probe for the zone; its output is discarded
        new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Today's calendar day in `timeZone`, as `YYYY-MM-DD`.
 *
 * The companion to civilToInstantISO, and it has to be: a form that reads the
 * typed time in one zone while defaulting the date from another can be a day
 * out near either end of the day, and the pair would disagree without anyone
 * touching a control. `todayLocalISO` answers this for the browser's own zone
 * only, which is the right answer exactly when the authoring zone IS the
 * browser's.
 *
 * Unknown zone → the browser's own day, never a silent UTC day: a UTC day is
 * already tomorrow for a third of the planet and yesterday for much of the rest.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
    if (!isUsableZone(timeZone)) {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    // Reuse the one reader that already knows how to pull civil fields in a zone;
    // its result is the wall clock read as if UTC, so the ISO prefix is the day.
    // tz-lint-ok: the instant here is ALREADY shifted into `timeZone`, so this
    // slice is that zone's calendar day, not a UTC day.
    return new Date(civilFieldsAsUtcMs(now.getTime(), timeZone)).toISOString().slice(0, 10);
}

/**
 * @param date `YYYY-MM-DD` as typed
 * @param time `HH:MM` as typed
 * @param timeZone IANA zone the typed values are read in; blank or unknown → UTC
 * @returns an ISO instant, or '' when either field is missing
 */
export function civilToInstantISO(date: string, time: string, timeZone: string): string {
    if (!date || !time) return '';
    // tz-lint-ok: this Z-suffixed parse is the provisional guess the loop below
    // corrects — it is the input to the offset calculation, never an output.
    const wanted = Date.parse(`${date}T${time}:00Z`);
    if (Number.isNaN(wanted)) return '';
    if (!isUsableZone(timeZone) || timeZone === 'UTC') return new Date(wanted).toISOString();

    // Offset east of UTC at an instant, in ms.
    const offsetAt = (instantMs: number) => civilFieldsAsUtcMs(instantMs, timeZone) - instantMs;

    // Correcting once is exact whenever the offset is the same on both sides of the
    // correction. Applying the correction a second time is NOT a refinement — on a
    // spring-forward day it walks back into the hour that does not exist. So take
    // both candidates and decide between them explicitly.
    const first = wanted - offsetAt(wanted);
    const second = wanted - offsetAt(first);
    if (first === second) return new Date(first).toISOString();

    // The two disagree only across a daylight-saving transition.
    const matches = [first, second].filter((c) => civilFieldsAsUtcMs(c, timeZone) === wanted);
    if (matches.length === 1) return new Date(matches[0]!).toISOString();
    // Overlap (autumn): both readings are valid — take the earlier, deterministically.
    // Gap (spring): neither is — take the later, so the booking lands after the jump
    // at a time that exists rather than before it at a time nobody chose.
    const chosen = matches.length === 2 ? Math.min(first, second) : Math.max(first, second);
    return new Date(chosen).toISOString();
}
