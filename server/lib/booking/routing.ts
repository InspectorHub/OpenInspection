import { epochMsToWallClockYmd } from '../tz';

/**
 * Which qualified, free inspector gets an auto-assigned booking.
 *
 * THE INVARIANT: a strategy that cannot be computed is REPORTED, never quietly
 * replaced. Both non-default strategies here have a degenerate input on which
 * they collapse into `first_available` while still returning a perfectly
 * plausible inspector id:
 *
 *   least_loaded  every candidate's week load is 0, so every comparison is a
 *                 tie and the tiebreak (name) IS first_available.
 *   closest       the property or the candidates have no coordinates, so
 *                 every distance is undefined and the tiebreak decides again.
 *
 * Both were live risks, not hypotheticals: `inspections.scheduled_start_ms` has
 * zero non-NULL rows in production (which is why load is counted off
 * `inspections.date`), and no booking carried a geocode until the public form
 * started capturing one. So the result type is a DECISION, not an id: it names
 * what was requested, what was applied, and why they differ. Callers log the
 * difference and stamp it on the fulfillment audit record.
 */
export type RoutingStrategy = 'first_available' | 'least_loaded' | 'closest';

export const ROUTING_STRATEGIES: readonly RoutingStrategy[] = [
    'first_available',
    'least_loaded',
    'closest',
] as const;

export function isRoutingStrategy(raw: unknown): raw is RoutingStrategy {
    return typeof raw === 'string' && (ROUTING_STRATEGIES as readonly string[]).includes(raw);
}

/** Why the requested strategy was not the one applied. */
type RoutingFallbackReason =
    /** `closest`: the property has no lat/lng, so no distance exists. */
    | 'property_ungeocoded'
    /** `closest`: fewer than two candidates have a service origin to measure from. */
    | 'no_anchored_candidate'
    /** `least_loaded`: no candidate has any dated work in the slot's ISO week. */
    | 'no_dated_work'
    /** Any strategy: one candidate, so no strategy could have chosen differently. */
    | 'single_candidate';

export interface RoutingDecision {
    inspectorId: string | null;
    requested: RoutingStrategy;
    /** Always `first_available` when `reason` is set. */
    applied: RoutingStrategy;
    reason: RoutingFallbackReason | null;
    /** How many candidates the strategy could choose between. */
    candidateCount: number;
}

export interface RoutingCandidate {
    id: string;
    name: string | null;
    /**
     * Where this inspector's drive starts: their own service origin, else the
     * company coordinates, else null. NULL is NOT a distance and NOT a
     * far-away sort position — it removes the candidate from `closest`
     * entirely (see `closest` below).
     */
    origin: { lat: number; lng: number } | null;
    /** Non-cancelled inspections dated inside the slot's ISO week. */
    weekLoad: number;
}

export interface RoutingInput {
    strategy: RoutingStrategy;
    candidates: RoutingCandidate[];
    /** The property's coordinates, when it has been geocoded. */
    property: { lat: number; lng: number } | null;
}

/** Stable order: name, then id. This IS `first_available`, and every tiebreak. */
function byNameThenId(a: RoutingCandidate, b: RoutingCandidate): number {
    return (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id);
}

/** Great-circle distance in kilometres. Only ever called with two real points. */
export function haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function firstAvailable(candidates: RoutingCandidate[]): string | null {
    return [...candidates].sort(byNameThenId)[0]?.id ?? null;
}

function substituted(
    requested: RoutingStrategy,
    reason: RoutingFallbackReason,
    candidates: RoutingCandidate[],
): RoutingDecision {
    return {
        inspectorId: firstAvailable(candidates),
        requested,
        applied: 'first_available',
        reason,
        candidateCount: candidates.length,
    };
}

/**
 * Choose. Pure — every DB read the strategies need is already in `input`,
 * which is what makes the degenerate cases testable without a database.
 */
export function pickInspectorByStrategy(input: RoutingInput): RoutingDecision {
    const { strategy, candidates, property } = input;
    if (candidates.length === 0) {
        return {
            inspectorId: null,
            requested: strategy,
            applied: strategy,
            reason: null,
            candidateCount: 0,
        };
    }

    if (strategy === 'first_available') {
        return {
            inspectorId: firstAvailable(candidates),
            requested: strategy,
            applied: strategy,
            reason: null,
            candidateCount: candidates.length,
        };
    }

    // One candidate: the strategy did not choose, arithmetic did not happen,
    // and reporting it as `least_loaded` would be a claim nobody verified.
    if (candidates.length === 1) {
        return substituted(strategy, 'single_candidate', candidates);
    }

    if (strategy === 'least_loaded') {
        // The whole point of the strategy is that loads DIFFER. All-zero is
        // not "everyone is equally free"; it is "we have no load signal", and
        // the tiebreak below would silently be first_available.
        if (candidates.every((c) => c.weekLoad === 0)) {
            return substituted(strategy, 'no_dated_work', candidates);
        }
        const sorted = [...candidates].sort(
            (a, b) => a.weekLoad - b.weekLoad || byNameThenId(a, b),
        );
        return {
            inspectorId: sorted[0]!.id,
            requested: strategy,
            applied: strategy,
            reason: null,
            candidateCount: candidates.length,
        };
    }

    // closest — a missing geocode is never a distance.
    if (!property) {
        return substituted(strategy, 'property_ungeocoded', candidates);
    }
    const anchored = candidates.filter((c) => c.origin !== null);
    if (anchored.length < 2) {
        return substituted(strategy, 'no_anchored_candidate', candidates);
    }
    const sorted = [...anchored].sort(
        (a, b) =>
            haversineKm(property, a.origin!) - haversineKm(property, b.origin!) ||
            byNameThenId(a, b),
    );
    return {
        inspectorId: sorted[0]!.id,
        requested: strategy,
        applied: strategy,
        reason: null,
        candidateCount: candidates.length,
    };
}

/**
 * The civil date a stored `inspections.date` denotes, in the tenant's zone.
 *
 * The column holds two shapes: a bare `YYYY-MM-DD` (wizard-created, calendar
 * semantic) and a full ISO instant (`fulfillBooking` writes `${date}T${hh}:${mm}:00Z`).
 * They must be read differently — parsing the bare form as UTC midnight and
 * converting it into a negative-offset zone moves the inspection to the
 * PREVIOUS day, which is the calendar off-by-one this codebase already has a
 * lint gate for. A civil date has no zone to convert from, so it is taken as
 * written; an instant goes through the tenant zone.
 */
export function inspectionCivilDate(stored: string, tenantTz: string): string | null {
    const raw = String(stored ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return null;
    return epochMsToWallClockYmd(ms, tenantTz);
}

/**
 * ISO-8601 week key (`GGGG-Www`) for a civil `YYYY-MM-DD`. Weeks start Monday
 * and belong to the year containing their Thursday, so a booking on 1 January
 * lands in the same bucket as the December work beside it.
 */
export function isoWeekKey(civilYmd: string): string {
    const [y, m, d] = civilYmd.split('-').map(Number);
    // UTC arithmetic on a civil date is pure calendar geometry here — the value
    // never becomes an instant anyone displays, so no zone is involved.
    const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
    const day = date.getUTCDay() || 7; // Sunday (0) is day 7 of the previous week
    date.setUTCDate(date.getUTCDate() + 4 - day); // move to this week's Thursday
    const isoYear = date.getUTCFullYear();
    const jan1 = Date.UTC(isoYear, 0, 1);
    const week = Math.ceil(((date.getTime() - jan1) / 86400000 + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Monday..Sunday civil dates of the ISO week containing `civilYmd`, widened by
 * one day on each side.
 *
 * The padding is not sloppiness — it is the only correct way to pre-filter in
 * SQL. `inspections.date` mixes UTC instants with civil dates, so a row whose
 * TENANT-local date is Monday can be stored as a Sunday-evening instant. The
 * SQL window over-collects by a day; `isoWeekKey(inspectionCivilDate(...))`
 * then decides membership exactly. Narrowing the SQL to the exact week would
 * silently drop the boundary jobs and understate somebody's load.
 */
export function isoWeekWindow(civilYmd: string): { fromYmd: string; toYmd: string } {
    const [y, m, d] = civilYmd.split('-').map(Number);
    const base = Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
    const day = new Date(base).getUTCDay() || 7;
    const monday = base - (day - 1) * 86400000;
    const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10); // tz-lint-ok: pure calendar geometry on a UTC-constructed civil date, never an instant
    return { fromYmd: ymd(monday - 86400000), toYmd: ymd(monday + 7 * 86400000) };
}
