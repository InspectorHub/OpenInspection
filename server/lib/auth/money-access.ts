import type { Context } from 'hono';
import type { CapabilitySet } from './capabilities';
import { redactMoney } from './money-redaction';
import { Errors } from '../errors';
import { capabilitiesFor } from '../middleware/require-capability';
import type { HonoConfig } from '../../types/hono';

/**
 * The two halves of the `financial` capability, in one place.
 *
 * READ  - `moneyView` projects a response through `redactMoney` (see
 *         ./money-redaction for why the keys are deleted, never zeroed).
 * WRITE - `assertMoneyWriteAllowed` refuses a request body that would set or
 *         change a money field. A gate on the whole endpoint would be wrong for
 *         the inspection PATCH: the settings form forwards every field it
 *         holds, so a caller without `financial` legitimately re-sends the
 *         price it was shown. Only a CHANGE is refused.
 */

/** Body keys that write money. Matched at any depth of the request body. */
const MONEY_WRITE_FIELDS: readonly string[] = [
    'price',
    'priceCents',
    'priceOverride',
    'priceOverrideCents',
    'defaultPriceCents',
    'depositRequiredCents',
];

/** Project a response payload for the acting user's `financial` capability. */
export async function moneyView<T>(c: Context<HonoConfig>, payload: T): Promise<T> {
    return redactMoney(payload, await capabilitiesFor(c));
}

/**
 * Handler-side form of `assertMoneyWriteAllowed`: resolves the caller's
 * capabilities, checks `body`, and returns it unchanged so it can sit inside an
 * expression. A body that is not a plain object is returned as-is (validation
 * will reject it); `current` is the stored row, or null for a create.
 */
export async function guardMoneyWrite<T>(
    c: Context<HonoConfig>,
    body: T,
    current: Record<string, unknown> | null,
    extraFields: readonly string[] = [],
): Promise<T> {
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        assertMoneyWriteAllowed(await capabilitiesFor(c), body as Record<string, unknown>, current, extraFields);
    }
    return body;
}

/**
 * Throw `FINANCIAL_REQUIRED` when `body` sets or changes a money field and the
 * caller lacks `financial`.
 *
 * `current` is the stored row for an update, or null for a create. On a create
 * any money field that is present and non-null is refused. On an update a field
 * is refused only when its value differs from the stored one; clearing a stored
 * value (null) is a change. Money nested in arrays or objects of the body has
 * no stored counterpart to compare against, so it is refused whenever present.
 *
 * `extraFields` widens the key list for one call site without widening the
 * global list.
 */
export function assertMoneyWriteAllowed(
    caps: Pick<CapabilitySet, 'financial'>,
    body: Record<string, unknown>,
    current: Record<string, unknown> | null,
    extraFields: readonly string[] = [],
): void {
    if (caps.financial) return;
    const fields = new Set([...MONEY_WRITE_FIELDS, ...extraFields]);

    for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        if (fields.has(key)) {
            if (current === null) {
                if (value !== null) throw Errors.FinancialRequired(key);
            } else if (!sameValue(current[key], value)) {
                throw Errors.FinancialRequired(key);
            }
            continue;
        }
        const nested = firstNestedMoneyKey(value, fields);
        if (nested) throw Errors.FinancialRequired(nested);
    }
}

/** Strict equality, or equal JSON for the structured policy objects a settings form resends. */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

function firstNestedMoneyKey(value: unknown, fields: ReadonlySet<string>): string | null {
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = firstNestedMoneyKey(item, fields);
            if (hit) return hit;
        }
        return null;
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) return null;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        if (fields.has(key)) return key;
        const hit = firstNestedMoneyKey(v, fields);
        if (hit) return hit;
    }
    return null;
}
