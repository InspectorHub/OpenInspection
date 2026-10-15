/**
 * Every endpoint whose 200/201 JSON schema can carry a money field, and how it
 * protects it. The scan in money-surface-registry.spec.ts fails when an endpoint
 * appears that is not listed here, and when a listed endpoint disappears.
 *
 *  - redact: the handler projects the payload through `moneyView`, so a caller
 *            without the `financial` capability receives no money key.
 *  - gate:   the route itself requires the `financial` capability (or serves a
 *            caller-scoped view of it, as pay splits do).
 *  - exempt: carries money that is not company money, with a whitelisted reason.
 *
 * The behaviour behind each `redact` and `gate` entry is asserted over HTTP in
 * tests/unit/inspections/money-redaction-routes.spec.ts, money-write-guard.spec.ts,
 * cancel-financial.spec.ts, tests/unit/invoices/financial-gates.spec.ts and
 * tests/unit/events/event-money.spec.ts.
 */
export type Disposition =
    | { kind: 'redact' }
    | { kind: 'gate' }
    | { kind: 'exempt'; reason: string };

const redact: Disposition = { kind: 'redact' };
const gate: Disposition = { kind: 'gate' };
const exempt = (reason: string): Disposition => ({ kind: 'exempt', reason });

export const MONEY_SURFACE: Record<string, Disposition> = {
    // Inspection hub and cancellation
    'GET /api/inspections/{id}/hub': redact,
    'GET /api/inspections/{id}/cancellation-quote': redact,
    'POST /api/inspections/{id}/cancel': redact,

    // Pay splits: financial gate on every verb (GET also serves a caller-scoped, read-only view)
    'GET /api/inspections/{id}/pay-splits': gate,
    'PATCH /api/inspections/{id}/pay-splits/{splitId}': gate,
    'POST /api/inspections/{id}/pay-splits/{splitId}/corrections': gate,
    'POST /api/team/payroll-export': gate,

    // Repair estimates belong to the client's repair request, not to company revenue
    'GET /api/inspections/{id}/cost-items': exempt('repair-estimate-not-company-money'),
    'GET /api/inspections/{id}/repair-requests': exempt('repair-estimate-not-company-money'),

    // Inspection requests carry their child inspections' prices
    'GET /api/inspection-requests': redact,
    'POST /api/inspection-requests': redact,
    'GET /api/inspection-requests/{id}': redact,
    'PUT /api/inspection-requests/{id}': redact,
    'GET /api/inspection-requests/by-inspection/{inspectionId}': redact,
    'POST /api/inspection-requests/{id}/inspections': redact,

    // Client-facing token track and the public booking surface
    'GET /api/public/inspections/{id}/invoice': exempt('client-facing-token-track'),
    'POST /api/public/inspections/{id}/pay-intent': exempt('client-facing-token-track'),
    'GET /api/public/report-gate/{tenant}/{id}': exempt('client-facing-token-track'),
    'POST /api/public/inspections/{id}/deposit-intent': exempt('client-facing-token-track'),
    'GET /api/public/services': exempt('client-facing-token-track'),
    'POST /api/public/book': exempt('client-facing-token-track'),
    'GET /api/public/checkout/:token': exempt('client-facing-token-track'),

    // Company settings that hold amounts
    'GET /api/admin/event-types': redact,
    'POST /api/admin/event-types': redact,
    'PATCH /api/admin/event-types/{id}': redact,
    'GET /api/admin/branding': redact,
    'POST /api/admin/branding': redact,

    'GET /api/contacts/{id}': redact,

    // Invoices and the payment ledger
    'GET /api/invoices': gate,
    'POST /api/invoices': gate,
    'POST /api/invoices/request-payment': redact,
    'GET /api/invoices/{id}/payments': gate,
    'POST /api/invoices/{id}/payments': gate,
    'POST /api/invoices/{id}/payments/{paymentId}/corrections': gate,

    // Service catalogue and pay rules
    'GET /api/services': redact,
    'POST /api/services': gate,
    'PUT /api/services/{id}': gate,
    'GET /api/services/{id}/pay-rules': gate,
    'POST /api/services/{id}/pay-rules': gate,
    'PUT /api/services/{id}/pay-rules/{ruleId}': gate,

    // Aggregates scope themselves by capability inside the handler
    'GET /api/metrics': redact,
};

/**
 * Endpoints that return money but whose OpenAPI response schema does not
 * DECLARE a money field (the handler returns the stored row), so the scan cannot
 * see them. Each is asserted by money-redaction-routes.spec.ts or
 * money-write-guard.spec.ts. The spec checks that every path here still exists.
 */
export const UNSCANNED_MONEY_SURFACE: Record<string, Disposition> = {
    'GET /api/inspections/{id}': redact,
    'GET /api/inspections/dashboard': redact,
    'POST /api/inspections': redact,
    'POST /api/inspections/{id}/clone': redact,
    'PATCH /api/inspections/{id}': gate,
    'GET /api/admin/export': redact,
};
