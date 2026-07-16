import federalByYear from './data/us-federal.json';
import statesByCode from './data/us-states.json';
import type { HolidayEntry, HolidayRegion, TenantCustomHoliday } from './types';

type YearBucket = Record<string, HolidayEntry[]>;

const FEDERAL = federalByYear as YearBucket;
const STATES = statesByCode as Record<string, YearBucket>;

export interface ResolveClosedDatesInput {
    region: HolidayRegion | null;
    customRows: Array<Pick<TenantCustomHoliday, 'date' | 'name'>>;
    year: number;
}

/**
 * Union federal (+ optional state) + custom holidays for one civil year.
 * `region = null` → empty map (catalog off; no behavior change).
 */
export function resolveCompanyClosedDates(
    input: ResolveClosedDatesInput,
): Map<string, string> {
    const out = new Map<string, string>();
    if (!input.region) return out;

    const yearKey = String(input.year);
    for (const entry of FEDERAL[yearKey] ?? []) {
        out.set(entry.date, entry.name);
    }

    if (input.region.startsWith('US-') && input.region.length === 5) {
        const state = input.region.slice(3);
        for (const entry of STATES[state]?.[yearKey] ?? []) {
            out.set(entry.date, entry.name);
        }
    }

    for (const row of input.customRows) {
        if (row.date.startsWith(yearKey)) {
            out.set(row.date, row.name);
        }
    }

    return out;
}

/** Resolve closed dates spanning an inclusive civil-date range (multi-year). */
export function resolveCompanyClosedDatesInRange(input: {
    region: HolidayRegion | null;
    customRows: Array<Pick<TenantCustomHoliday, 'date' | 'name'>>;
    startDate: string;
    endDate: string;
}): Map<string, string> {
    if (!input.region) return new Map();
    const startYear = Number(input.startDate.slice(0, 4));
    const endYear = Number(input.endDate.slice(0, 4));
    const merged = new Map<string, string>();
    for (let year = startYear; year <= endYear; year++) {
        const yearMap = resolveCompanyClosedDates({
            region: input.region,
            customRows: input.customRows,
            year,
        });
        for (const [date, name] of yearMap) {
            if (date >= input.startDate && date <= input.endDate) {
                merged.set(date, name);
            }
        }
    }
    return merged;
}

const SUPPORTED_STATE_CODES = ['TX', 'CA', 'NY', 'FL', 'IL'] as const;

export function parseHolidayRegion(raw: string | null | undefined): HolidayRegion | null {
    if (!raw) return null;
    if (raw === 'US') return 'US';
    const m = /^US-([A-Z]{2})$/.exec(raw);
    if (!m) return null;
    const state = m[1] as (typeof SUPPORTED_STATE_CODES)[number];
    if (!(SUPPORTED_STATE_CODES as readonly string[]).includes(state)) return null;
    return `US-${state}`;
}
