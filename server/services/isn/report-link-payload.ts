/**
 * PURE: a published report → the fields ISN's `PUT /orders/addreporturl` reads.
 *
 * Its own module so the contract spec can check it against ISN's published
 * schema without constructing anything (docs/develop/integration-adapters.md).
 */

export interface ReportLinkInput {
    /** ISN's order uuid (resolved from the order number first). */
    orderId: string;
    url: string;
    title: string;
}

/**
 * `public` is what puts the row on the client's ISN report-delivery page — the
 * "Public" checkbox in the order's Inspection Reports area. It does NOT bypass
 * ISN's own payment/signature hold. A non-public row is visible only in ISN's
 * office view, so a report link sent to ISN is always public.
 */
export function buildReportLinkParams(input: ReportLinkInput): Record<string, string> {
    return { id: input.orderId, url: input.url, title: input.title, public: 'true' };
}
