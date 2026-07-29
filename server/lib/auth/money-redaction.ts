import type { CapabilitySet } from './capabilities';

/**
 * One place that decides whether a response may carry money.
 *
 * The `financial` capability existed and was correct — `requireCapability`
 * enforced it, and its middleware tests covered the guardrails. It just was not
 * WORN by enough endpoints: it guarded `GET /api/invoices` while
 * `GET /api/inspections/:id/hub` and `GET /api/services` returned the same
 * figures with no capability check at all. `ROLE_DEFAULTS.inspector.financial`
 * is false, so that was the DEFAULT configuration leaking, not an edge case.
 *
 * Each endpoint stripping its own fields would recreate that: three sites, three
 * chances to forget one. So there is exactly one redactor, and it keys off a
 * convention the schema rules already mandate — "money columns end in `_cents`"
 * — which in TypeScript surfaces as a field ending in `Cents`, plus the legacy
 * `price` column that predates the rule.
 *
 * Redaction DELETES the key rather than zeroing it. A zero is a lie an operator
 * could act on; an absent field is the truth ("you may not see this"), and the
 * schemas mark these fields optional so the compiler forces the UI to handle it.
 */

/** A money field, by the naming convention the schema rules require. */
export function isMoneyField(key: string): boolean {
    return key === 'price' || /Cents$/.test(key);
}

/**
 * Recursively drop money fields unless the caller may see financial data.
 * Returns the input untouched when `financial` is granted, so the permitted
 * path costs nothing.
 *
 * Arrays and plain objects are walked; everything else (Date, null, primitives)
 * passes through by identity — notably, this must never try to rebuild a Date,
 * which a naive object spread would flatten into `{}`.
 */
export function redactMoney<T>(value: T, caps: Pick<CapabilitySet, 'financial'>): T {
    if (caps.financial) return value;
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
