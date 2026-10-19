/**
 * Bounds for the "which of these inspections can I still see" check a native device makes when it
 * comes back online.
 *
 * A request carries up to `NATIVE_VISIBLE_MAX_IDS` ids (default 300). Every id costs one bind
 * parameter, and D1 allows 100 bind parameters per statement, so the ids are looked up in chunks of
 * `VISIBLE_IDS_PER_QUERY`. A chunk's statement also binds the company id and, for a caller restricted
 * to their assigned inspections, the five parameters of the assignment condition, so the chunk size
 * leaves room for both: no statement binds more than 90 parameters.
 *
 * Reading the variable never throws. A missing, blank or non-numeric value falls back to the default
 * and a number outside the allowed range is clamped into it, so a misconfiguration can never switch
 * the limit off.
 */

export const DEFAULT_VISIBLE_IDS_LIMIT = 300;
export const VISIBLE_IDS_LIMIT_CEILING = 2000;
const VISIBLE_IDS_LIMIT_FLOOR = 1;

/** Ids per D1 statement: 80 ids + the company id + the restricted-caller condition stay under 90. */
export const VISIBLE_IDS_PER_QUERY = 80;

/** What an id may look like: the shapes the engine generates and a device may choose for itself. */
export const VISIBLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Operator-set override. Optional: unset means the default. */
export interface NativeVisibleEnv {
    NATIVE_VISIBLE_MAX_IDS?: string;
}

export function readVisibleIdsLimit(env: NativeVisibleEnv): number {
    const text = env.NATIVE_VISIBLE_MAX_IDS?.trim();
    if (!text || !/^\d{1,15}$/.test(text)) return DEFAULT_VISIBLE_IDS_LIMIT;
    return Math.min(VISIBLE_IDS_LIMIT_CEILING, Math.max(VISIBLE_IDS_LIMIT_FLOOR, Number(text)));
}
