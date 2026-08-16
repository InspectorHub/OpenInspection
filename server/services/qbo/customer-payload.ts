/**
 * Rendering one of our contacts as a QuickBooks Customer document.
 *
 * Pure and separate for the same reason as `invoice-payload.ts`: which fields
 * QuickBooks accepts is a question about SHAPE, and answering it should not
 * require reading an adoption lookup and a retry ladder. It also makes the
 * shape reachable from `tests/contract/qbo/`, which checks it against Intuit's
 * own schema without a network call.
 */

/** The contact fields a Customer document is built from. */
export interface CustomerSource {
    email?: string | null;
    phone?: string | null;
    agency?: string | null;
}

/**
 * Split a single stored name into QuickBooks' two.
 *
 * The fallback matters: `FamilyName` repeats the first token for a one-word
 * name rather than going empty, because a Customer with a blank family name
 * sorts and searches badly in QuickBooks' own UI.
 */
export function splitName(name: string): { firstName: string; lastName: string } {
    const parts = name.trim().split(' ');
    const firstName = parts[0] ?? '';
    return { firstName, lastName: parts.slice(1).join(' ') || firstName };
}

/**
 * Strip the characters QuickBooks refuses in a `DisplayName`.
 *
 * The colon is reserved on their side for the parent:sub-customer hierarchy, so
 * a name carrying one is rejected outright:
 *
 *     code 2040, element DisplayName
 *     "Element contains invalid characters. Colon: Test Client"
 *
 * (captured from the sandbox, 2026-08-16 — and Intuit states the rule in its
 * own schema: "The customer name must not contain a colon (:)".) The refusal is
 * permanent, because the duplicate-name ladder only re-tries a duplicate, so a
 * contact called "Smith Trust: 2019" never gets a QuickBooks twin — which then
 * silently disables the invoice, payment and credit-memo pushes behind it.
 *
 * Only `DisplayName`. `GivenName` accepts a colon (verified in the same
 * capture), and the contact's name in OUR database is not touched at all: this
 * is a rendering rule for one field of one outbound document, not a correction
 * to what the customer is called.
 *
 * Deliberately narrow. Stripping every character some API somewhere might
 * dislike would mangle real names on speculation; anything else QuickBooks
 * refuses should surface as a real 2040 naming the element, which is now
 * legible thanks to `describeQboError`.
 */
export function sanitizeDisplayName(name: string): string {
    return name.replace(/:/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * `undefined` rather than `null` for the absent optionals: `JSON.stringify`
 * drops an undefined key entirely, while an explicit null is a value
 * QuickBooks would have to interpret — and for `PrimaryEmailAddr` it interprets
 * it as clearing an address the tenant may have set on their side.
 */
export function buildCustomerPayload(
    displayName: string,
    firstName: string,
    lastName: string,
    contact: CustomerSource,
): Record<string, unknown> {
    return {
        // Sanitised HERE as well as at every rung of the ladder. This function
        // is the last thing between a name and the wire, and a guarantee that
        // holds only when one particular caller remembers is not a guarantee.
        // The operation is idempotent, so the double application costs nothing.
        DisplayName:      sanitizeDisplayName(displayName),
        GivenName:        firstName,
        FamilyName:       lastName,
        CompanyName:      contact.agency ?? undefined,
        PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
        PrimaryPhone:     contact.phone ? { FreeFormNumber: contact.phone } : undefined,
    };
}
