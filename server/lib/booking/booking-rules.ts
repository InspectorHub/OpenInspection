import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import { epochMsToWallClockYmd, epochMsToWallClockHm, wallClockToEpochMs, resolveTenantTimeZone } from '../tz';

/**
 * Tenant booking rules: how far ahead a client must book, and when today's
 * remaining slots stop being offered.
 *
 * Both are stated in the OFFICE's terms — hours of notice, and a wall-clock
 * cutoff in the tenant zone — so every comparison here goes through
 * `server/lib/tz.ts`. A UTC-day bucket would ship green until this change put
 * `server/lib/booking` inside the `check-tz-safety.mjs` SCOPE, and it would be
 * wrong for every tenant west of UTC after 17:00 local.
 *
 * Sibling naming: `slot-rules.ts` owns the slot GRID (mode + interval);
 * this file owns whether a computed slot may still be booked.
 */

/** Why a slot is not offerable. `null` when it is. */
export type BookingRuleBlockReason = 'min_lead' | 'same_day_cutoff';

export interface BookingRules {
    /** Hours of notice required. 0 = no lead requirement (the default). */
    minLeadHours: number;
    /** Wall-clock `HH:MM` in the tenant zone, or null for no cutoff. */
    sameDayCutoffTime: string | null;
}

export interface BookingRuleInput extends BookingRules {
    /** The slot's civil date, `YYYY-MM-DD`, in the tenant zone. */
    civilDate: string;
    /** The slot's wall-clock start, `HH:MM`, in the tenant zone. */
    slotTime: string;
    tenantTz: string;
    nowMs: number;
}

export interface BookingRuleVerdict {
    allowed: boolean;
    reason: BookingRuleBlockReason | null;
}

const ALLOWED: BookingRuleVerdict = { allowed: true, reason: null };

/** Normalize a stored cutoff. Anything that is not `HH:MM` means "no cutoff". */
export function parseCutoffTime(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
}

/** Clamp a stored lead time to something a slot filter can act on. */
export function parseMinLeadHours(raw: number | null | undefined): number {
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // A year of required notice is a data-entry accident, not a policy.
    return Math.min(Math.floor(n), 24 * 365);
}

/**
 * Whether one slot may still be booked.
 *
 * Order matters and is deliberate: the lead requirement is the stronger,
 * always-on rule, so it is evaluated first and its reason wins when both
 * apply. A UI that reports `same_day_cutoff` on a slot that also violates a
 * 48-hour lead would send the client back tomorrow to hit the same wall.
 */
export function applyBookingRules(input: BookingRuleInput): BookingRuleVerdict {
    const { civilDate, slotTime, tenantTz, nowMs } = input;
    const minLeadHours = parseMinLeadHours(input.minLeadHours);
    const cutoff = parseCutoffTime(input.sameDayCutoffTime);
    if (minLeadHours === 0 && cutoff === null) return ALLOWED;

    const slotMs = wallClockToEpochMs(civilDate, slotTime, tenantTz);

    if (minLeadHours > 0 && slotMs - nowMs < minLeadHours * 3600_000) {
        return { allowed: false, reason: 'min_lead' };
    }

    if (cutoff !== null) {
        const todayLocal = epochMsToWallClockYmd(nowMs, tenantTz);
        // "Same day" means the OFFICE's today, which is why both sides of this
        // comparison are wall-clock in the tenant zone.
        if (civilDate === todayLocal && epochMsToWallClockHm(nowMs, tenantTz) >= cutoff) {
            return { allowed: false, reason: 'same_day_cutoff' };
        }
    }

    return ALLOWED;
}

/** What a tenant's booking rules amount to, resolved once per slot request. */
export interface LoadedBookingRules extends BookingRules {
    tenantTz: string;
    /** True when neither rule is configured — the caller can skip the filter. */
    inactive: boolean;
}

/** Loader beside the rules, same shape as `loadSlotGridOptions` in slot-rules.ts. */
export async function loadBookingRules(
    d1: D1Database,
    tenantId: string,
): Promise<LoadedBookingRules> {
    const row = await drizzle(d1).select({
        minLeadHours: tenantConfigs.bookingMinLeadHours,
        cutoff: tenantConfigs.bookingSameDayCutoffTime,
        defaultTimezone: tenantConfigs.defaultTimezone,
    }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

    const minLeadHours = parseMinLeadHours(row?.minLeadHours);
    const sameDayCutoffTime = parseCutoffTime(row?.cutoff);
    return {
        minLeadHours,
        sameDayCutoffTime,
        tenantTz: resolveTenantTimeZone(row?.defaultTimezone),
        inactive: minLeadHours === 0 && sameDayCutoffTime === null,
    };
}
