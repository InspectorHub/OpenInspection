/**
 * Every endpoint whose 200/201 JSON schema can carry a money field, and how it
 * protects it. The scan in money-surface-registry.spec.ts fails when an endpoint
 * appears that is not listed here, and when a listed endpoint disappears.
 *
 *  - redact: the handler projects the payload through `moneyView` (or
 *            `redactMoney`), so a caller without the named capability receives
 *            no money key. `file` is the route file under server/api that does
 *            it; the scan checks that file names the bucket.
 *  - gate:   the route itself requires the named capability (or serves a
 *            caller-scoped view of it, as pay splits do). The scan checks the
 *            route's `x-capability` equals the bucket; a gate with no declared
 *            capability (the inspection PATCH guards by field, the pay-split
 *            GET serves a caller-scoped view) names its file and the scan
 *            checks that file calls `guardMoneyWrite` or reads `caps.<bucket>`.
 *  - exempt: carries money that is not company money, with a whitelisted reason.
 *
 * Every redact and gate names its bucket: `inspectionFees` for money on one
 * inspection you can open, `companyFinance` for company-wide money. An endpoint
 * whose response mixes the two lists both.
 *
 * The behaviour behind each `redact` and `gate` entry is asserted over HTTP in
 * tests/unit/inspections/money-redaction-routes.spec.ts, money-write-guard.spec.ts,
 * cancel-financial.spec.ts, tests/unit/invoices/financial-gates.spec.ts and
 * tests/unit/events/event-money.spec.ts.
 */
import type { MoneyBucket } from '../../../server/lib/auth/money-redaction';

export type Disposition =
    | { kind: 'redact'; bucket: readonly MoneyBucket[]; file: string }
    | { kind: 'gate'; bucket: readonly MoneyBucket[]; file?: string }
    | { kind: 'exempt'; reason: string };

const redact = (bucket: MoneyBucket | readonly MoneyBucket[], file: string): Disposition =>
    ({ kind: 'redact', bucket: typeof bucket === 'string' ? [bucket] : bucket, file });
const gate = (bucket: MoneyBucket, file?: string): Disposition => ({ kind: 'gate', bucket: [bucket], file });
const exempt = (reason: string): Disposition => ({ kind: 'exempt', reason });

export const MONEY_SURFACE: Record<string, Disposition> = {
    // Inspection hub and cancellation
    'GET /api/inspections/{id}/hub': redact(['inspectionFees', 'companyFinance'], 'inspections/report-delivery.ts'),
    'GET /api/inspections/{id}/cancellation-quote': redact('inspectionFees', 'inspections/cancellation.ts'),
    'POST /api/inspections/{id}/cancel': redact('inspectionFees', 'inspections/cancellation.ts'),

    // Pay splits: companyFinance gate on every verb (GET also serves a caller-scoped, read-only view)
    'GET /api/inspections/{id}/pay-splits': gate('companyFinance', 'inspections/pay-splits.ts'),
    'PATCH /api/inspections/{id}/pay-splits/{splitId}': gate('companyFinance'),
    'POST /api/inspections/{id}/pay-splits/{splitId}/corrections': gate('companyFinance'),
    'POST /api/team/payroll-export': gate('companyFinance'),

    // Repair estimates belong to the client's repair request, not to company revenue
    'GET /api/inspections/{id}/cost-items': exempt('repair-estimate-not-company-money'),
    'GET /api/inspections/{id}/repair-requests': exempt('repair-estimate-not-company-money'),

    // Inspection requests carry their child inspections' prices
    'GET /api/inspection-requests': redact('inspectionFees', 'inspection-requests.ts'),
    'POST /api/inspection-requests': redact('inspectionFees', 'inspection-requests.ts'),
    'GET /api/inspection-requests/{id}': redact('inspectionFees', 'inspection-requests.ts'),
    'PUT /api/inspection-requests/{id}': redact('inspectionFees', 'inspection-requests.ts'),
    'GET /api/inspection-requests/by-inspection/{inspectionId}': redact('inspectionFees', 'inspection-requests.ts'),
    'POST /api/inspection-requests/{id}/inspections': redact('inspectionFees', 'inspection-requests.ts'),

    // Client-facing token track and the public booking surface
    'GET /api/public/inspections/{id}/invoice': exempt('client-facing-token-track'),
    'POST /api/public/inspections/{id}/pay-intent': exempt('client-facing-token-track'),
    'GET /api/public/report-gate/{tenant}/{id}': exempt('client-facing-token-track'),
    'POST /api/public/inspections/{id}/deposit-intent': exempt('client-facing-token-track'),
    'GET /api/public/services': exempt('client-facing-token-track'),
    'POST /api/public/book': exempt('client-facing-token-track'),
    'GET /api/public/checkout/:token': exempt('client-facing-token-track'),

    // Company settings that hold amounts
    'GET /api/admin/event-types': redact('inspectionFees', 'admin/admin-settings.ts'),
    'POST /api/admin/event-types': redact('inspectionFees', 'admin/admin-settings.ts'),
    'PATCH /api/admin/event-types/{id}': redact('inspectionFees', 'admin/admin-settings.ts'),
    'GET /api/admin/branding': redact('companyFinance', 'admin/branding.ts'),
    'POST /api/admin/branding': redact('companyFinance', 'admin/branding.ts'),

    'GET /api/contacts/{id}': redact(['inspectionFees', 'companyFinance'], 'contacts.ts'),

    // Invoices and the payment ledger
    'GET /api/invoices': gate('companyFinance'),
    'POST /api/invoices': gate('companyFinance'),
    'POST /api/invoices/request-payment': redact('inspectionFees', 'invoices.ts'),
    'GET /api/invoices/{id}/payments': gate('companyFinance'),
    'POST /api/invoices/{id}/payments': gate('companyFinance'),
    'POST /api/invoices/{id}/payments/{paymentId}/corrections': gate('companyFinance'),

    // Service catalogue and pay rules
    'GET /api/services': redact('inspectionFees', 'services.ts'),
    'POST /api/services': gate('companyFinance'),
    'PUT /api/services/{id}': gate('companyFinance'),
    'GET /api/services/{id}/pay-rules': gate('companyFinance'),
    'POST /api/services/{id}/pay-rules': gate('companyFinance'),
    'PUT /api/services/{id}/pay-rules/{ruleId}': gate('companyFinance'),

    // Aggregates scope themselves by capability inside the handler
    'GET /api/metrics': redact('companyFinance', 'metrics.ts'),
};

/**
 * Endpoints that return money but whose OpenAPI response schema does not
 * DECLARE a money field (the handler returns the stored row), so the scan cannot
 * see them. Each is asserted by money-redaction-routes.spec.ts or
 * money-write-guard.spec.ts. The spec checks that every path here still exists.
 */
export const UNSCANNED_MONEY_SURFACE: Record<string, Disposition> = {
    'GET /api/inspections/{id}': redact('inspectionFees', 'inspections/core.ts'),
    'GET /api/inspections/dashboard': redact('inspectionFees', 'inspections/bulk.ts'),
    'POST /api/inspections': redact('inspectionFees', 'inspections/core.ts'),
    'POST /api/inspections/{id}/clone': redact('inspectionFees', 'inspections/core.ts'),
    'PATCH /api/inspections/{id}': gate('inspectionFees', 'inspections/core.ts'),
    'GET /api/admin/export': redact('companyFinance', 'admin/admin-data.ts'),
};
