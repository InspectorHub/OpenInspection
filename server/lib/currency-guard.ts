/**
 * i18n Phase B — the tenant currency-change guard.
 *
 * Switching a tenant's currency after invoices exist is a data-integrity hazard.
 * The per-invoice snapshot keeps historical records self-describing, but mixing a
 * new tenant currency with old snapshots must be a deliberate, warned action —
 * never a silent switch. This pure predicate decides whether the Workspace save
 * must be blocked pending an explicit confirmation.
 */
export interface CurrencyChangeCheck {
    /** The tenant's current stored currency (ISO 4217), or null/undefined if unset. */
    current: string | null | undefined;
    /** The currency the save is trying to set. Undefined means "not changing currency". */
    next: string | undefined;
    /** How many invoices the tenant already has. */
    invoiceCount: number;
    /** Whether the caller passed the explicit confirm flag. */
    confirmed: boolean;
}

/**
 * True when the save must be blocked: the currency is actually changing, at least
 * one invoice already exists, and the caller has NOT confirmed. A no-op change
 * (same currency, or no currency in the payload) never blocks; neither does the
 * first-ever currency set (no invoices yet).
 */
export function needsCurrencyChangeConfirm({ current, next, invoiceCount, confirmed }: CurrencyChangeCheck): boolean {
    if (confirmed) return false;
    if (!next) return false;                 // currency not part of this save
    if (!current || current === next) return false; // no change (or first-ever set)
    return invoiceCount > 0;
}
