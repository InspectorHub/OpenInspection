import type { CapabilitySet } from './capabilities';

/** The two kinds of money a caller may be allowed to see or change; each is its own capability. */
export type MoneyBucket = 'inspectionFees' | 'companyFinance';

/**
 * One redactor decides whether a response carries money. Each endpoint names the bucket it belongs to, so the rule is stated in
 * one place.
 *
 * There are two buckets. `inspectionFees` covers the money on one inspection you can open (price, deposit, service lines,
 * cancellation fee); `companyFinance` covers company-wide money (invoices and payments, price lists, earnings, integrations,
 * fee policies).
 *
 * The redactor keys off a convention the schema rules already mandate - "money columns end in `_cents`" - which in TypeScript
 * surfaces as a field ending in `Cents`, plus the legacy `price` column that predates the rule.
 *
 * The write half of the capability, and the response helper handlers call, are in
 * ./money-access.ts.
 *
 * Redaction DELETES the key rather than zeroing it. A zero is a lie an operator
 * could act on; an absent field is the truth ("you may not see this"), and the
 * schemas mark these fields optional so the compiler forces the UI to handle it.
 */

/**
 * Money fields whose key does not end in `Cents`: the legacy `price`, and the columns named before the rule (`discountAmount`, and the service
 * line's `priceOverride` and `priceSnapshot`). tests/unit/auth/money-columns.spec.ts fails for any other `_cents` column whose key is not
 * matched, so a new one cannot slip by.
 */
const MONEY_KEYS_WITHOUT_SUFFIX: ReadonlySet<string> = new Set(['price', 'discountAmount', 'priceOverride', 'priceSnapshot']);

/** A money field, by the naming convention the schema rules require. */
export function isMoneyField(key: string): boolean {
    return MONEY_KEYS_WITHOUT_SUFFIX.has(key) || /Cents$/.test(key);
}

/** True when `value` carries a money field anywhere. Lets a caller skip the capability lookup for a payload with nothing to redact. */
export function hasMoneyField(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasMoneyField);
    if (value === null || typeof value !== 'object' || value instanceof Date) return false;
    return Object.entries(value as Record<string, unknown>).some(([key, v]) => isMoneyField(key) || hasMoneyField(v));
}

/**
 * Recursively drop money fields unless the caller holds the capability for
 * `bucket`. Returns the input untouched when it is granted, so the permitted
 * path costs nothing.
 *
 * Arrays and plain objects are walked; everything else (Date, null, primitives)
 * passes through by identity — notably, this must never try to rebuild a Date,
 * which a naive object spread would flatten into `{}`.
 */
export function redactMoney<T>(value: T, caps: Pick<CapabilitySet, MoneyBucket>, bucket: MoneyBucket): T {
    if (caps[bucket]) return value;
    return walk(value) as T;
}

function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return value;

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (isMoneyField(key)) continue;
        out[key] = walk(val);
    }
    return out;
}
