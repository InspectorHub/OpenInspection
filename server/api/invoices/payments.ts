import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import {
    CorrectPaymentSchema,
    INVOICE_ID,
    PaymentLedgerRowSchema,
    RecordOfflinePaymentSchema,
} from '../../lib/validations/invoice.schema';
import { safeISODate } from '../../lib/date';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { qboPaymentKey } from '../../lib/qbo-payment-key';

/**
 * The payment-ledger sub-resource of an invoice — everything under
 * `/api/invoices/{id}/payments`.
 *
 * It is its own module because the ledger is its own thing: append-only rows
 * describing money that moved, with their own capability gate (`financial`),
 * their own correction mechanism, and their own relationship to QuickBooks.
 * The parent module owns the invoice ROW — create, send, void, delete.
 */

/**
 * Offline payment recording — `POST /api/invoices/{id}/payments`.
 *
 * The smallest real thing the payment ledger makes possible: an inspector takes
 * $200 cash at the door and says so. It appends ONE ledger row and calls no
 * payment provider, because the money already moved outside every system we
 * integrate with.
 *
 * Capability-gated on `financial`, the same gate the rest of the billing
 * surface wears, and `recorded_by` is the authenticated user rather than
 * anything in the body — an unattributed money entry is worthless in a dispute.
 */
const recordOfflinePaymentRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/payments',
    tags: ['invoices'], summary: 'Record an offline payment against an invoice',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('financial')],
    request: {
        params: z.object({ id: INVOICE_ID.describe('Invoice the money was received against.') }).describe('Path params for the record-payment endpoint.'),
        body: { content: { 'application/json': { schema: RecordOfflinePaymentSchema } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('Always true; failures arrive as an error status.'),
                data: PaymentLedgerRowSchema.describe('The ledger row that was appended.'),
            }) } },
            description: 'Payment recorded',
        },
        404: { description: 'Invoice not found in this tenant' },
        409: { description: 'Invoice is void' },
        422: { description: 'Amount exceeds the outstanding balance and was not confirmed' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'recordInvoiceOfflinePayment',
    description: 'Appends one payment-ledger row for money received outside the system (cash, cheque, other offline method). The date the money moved is supplied by the caller, never defaulted to now, and the recording user is taken from the session.',
}, { scopes: ['write'], tier: 'extended', capability: 'financial' }));

/**
 * The correction path — `POST /api/invoices/{id}/payments/{paymentId}/corrections`.
 *
 * Append-only means a typo is fixed by a new row, so this has to ship in the
 * same release as the recording endpoint: without it the first mistake becomes
 * a manual database edit.
 */
const correctPaymentRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/payments/{paymentId}/corrections',
    tags: ['invoices'], summary: 'Correct a mistyped payment on an invoice',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('financial')],
    request: {
        params: z.object({
            id: INVOICE_ID.describe('Invoice the mistyped payment was recorded against.'),
            paymentId: z.string().trim().min(1).describe('Ledger row id of the payment being corrected.'),
        }).describe('Path params for the payment-correction endpoint.'),
        body: { content: { 'application/json': { schema: CorrectPaymentSchema } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('Always true; failures arrive as an error status.'),
                data: PaymentLedgerRowSchema.describe('The correcting ledger row that was appended.'),
            }) } },
            description: 'Correction recorded',
        },
        404: { description: 'Payment not found on this invoice in this tenant' },
        409: { description: 'Payment has already been corrected' },
        422: { description: 'Correction does not lower the recorded amount' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'correctInvoicePayment',
    description: 'Corrects a mistyped payment by appending a reversing ledger row rather than editing the original, which survives. The correcting row inherits the date the money moved, so the correction lands in the period the mistake did.',
}, { scopes: ['write'], tier: 'extended', capability: 'financial' }));

const listInvoicePaymentsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/payments',
    tags: ['invoices'], summary: 'List the payment ledger for an invoice',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('financial')],
    request: { params: z.object({ id: INVOICE_ID.describe('Invoice whose ledger rows to return.') }).describe('Path params for the payment-ledger endpoint.') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('Always true; failures arrive as an error status.'),
                data: z.array(PaymentLedgerRowSchema).describe('Ledger rows for this invoice, oldest movement first.'),
            }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listInvoicePayments',
    description: 'Returns every payment-ledger row recorded against one invoice, ordered by when the money moved, with the recording user resolved. Once an invoice can hold several payments a single total no longer answers a dispute.',
}, { scopes: ['read'], tier: 'extended', capability: 'financial' }));

const invoicePaymentRoutes = createApiRouter()
    .openapi(recordOfflinePaymentRoute, async (c) => {
        const id = c.req.valid('param').id as string;
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        // The recorder is the SESSION, never the body. A money entry nobody is
        // named on cannot be defended when the payment is later disputed.
        const recordedBy = c.get('user')?.sub as string;

        const appended = await c.var.services.invoice.recordOfflinePayment(tenantId, id, {
            amountCents: body.amountCents,
            method: body.method,
            // Parsed once, here at the boundary — the schema has already refused
            // an unparseable or future instant.
            occurredAt: new Date(body.occurredAt),
            note: body.note ?? null,
            allowOverpayment: body.allowOverpayment,
            recordedBy,
        });

        // A payment that closes the invoice must also close the report's payment
        // gate, exactly as mark-paid does. A PARTIAL one must not: the gate asks
        // whether the invoice is settled, not whether any money arrived.
        const inv = await c.var.services.invoice.findById(tenantId, id);
        if (inv?.paidAt && inv.inspectionId) {
            await c.var.services.inspection.markPaymentReceived(tenantId, inv.inspectionId);
        }
        // QuickBooks is a book of record, not a payment provider — the "no
        // provider call" rule is about not charging anyone, and cash that never
        // reaches the books is exactly the revenue this feature exists to stop
        // losing. What is pushed is the ROW that was appended (its amount and
        // its id as the idempotency key), never the invoice total.
        if (c.env.QBO_CLIENT_ID) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.recordPayment(
                    tenantId, id, appended.amountCents / 100, qboPaymentKey(appended.id),
                    appended.occurredAt,
                ),
            );
        }

        return c.json({
            success: true as const,
            data: {
                id: appended.id,
                kind: appended.kind,
                amountCents: appended.amountCents,
                method: body.method,
                provider: null,
                note: body.note ?? null,
                occurredAt: safeISODate(appended.occurredAt),
                recordedBy,
                // Resolved by the ledger LIST, which the surface reloads right
                // after; re-reading the user row here would buy one label.
                recordedByName: null,
                refundsId: null,
            },
        }, 201);
    })
    .openapi(correctPaymentRoute, async (c) => {
        const { id, paymentId } = c.req.valid('param') as { id: string; paymentId: string };
        const tenantId = c.get('tenantId');
        const { correctedAmountCents, reason } = c.req.valid('json');
        const recordedBy = c.get('user')?.sub as string;

        // The service also re-syncs the report's payment gate: a correction can
        // take an invoice back OUT of paid, which is precisely the state the old
        // column model could not express.
        const appended = await c.var.services.invoice.correctPayment(tenantId, id, paymentId, {
            correctedAmountCents, reason, recordedBy,
        });
        // Deliberately NOT pushed to QuickBooks. A reversal there is not a
        // negative payment — it is an operation on the payment already booked,
        // and inventing a negative amount would post nonsense to somebody's
        // books. Reconciling corrections belongs to the QBO sync work, not here.

        return c.json({
            success: true as const,
            data: {
                id: appended.id,
                kind: appended.kind,
                amountCents: appended.amountCents,
                method: appended.method,
                provider: null,
                note: appended.note,
                occurredAt: safeISODate(appended.occurredAt),
                recordedBy,
                recordedByName: null,
                refundsId: appended.refundsId,
            },
        }, 201);
    })
    .openapi(listInvoicePaymentsRoute, async (c) => {
        const id = c.req.valid('param').id as string;
        const rows = await c.var.services.invoice.listPayments(c.get('tenantId'), id);
        return c.json({ success: true as const, data: rows }, 200);
    });

export default invoicePaymentRoutes;
