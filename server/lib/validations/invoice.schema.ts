import { z } from '@hono/zod-openapi';
import { PublicBrandSchema } from './public-brand.schema';

/**
 * `invoices.id` is an opaque TEXT id, so a route must not demand a UUID shape it
 * never promised. The mark-paid endpoint rejected one with a 400 that the page
 * then swallowed, leaving an operator who had just banked a cheque looking at an
 * unchanged "SENT" pill. Same defect as the contacts id contract and as the
 * `inspectorId` `.uuid()` in IA-87.
 */
export const INVOICE_ID = z.string().trim().min(1);

const LineItemSchema = z.object({
    description: z.string().min(1).max(200).describe('TODO describe description field for the OpenInspection MCP integration'),
    amountCents: z.number().int().min(0).describe('TODO describe amountCents field for the OpenInspection MCP integration'),
});

export const CreateInvoiceSchema = z.object({
    inspectionId: z.string().trim().min(1).optional().nullable().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    contactId: z.string().trim().min(1).optional().nullable()
        .describe('Contact this invoice bills. When omitted, resolved from clientEmail; a name is never used to match.'),
    clientName: z.string().min(1).max(100).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().optional().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    amountCents: z.number().int().min(0).describe('TODO describe amountCents field for the OpenInspection MCP integration'),
    lineItems: z.array(LineItemSchema).default([]).describe('TODO describe lineItems field for the OpenInspection MCP integration'),
    dueDate: z.string().date().optional().nullable().openapi({ example: '2026-05-15' }).describe('TODO describe dueDate field for the OpenInspection MCP integration'),
    notes: z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
}).openapi('CreateInvoice');

/**
 * Task 8 (Issue #111) — body for POST /api/invoices/request-payment. The hub
 * Invoice card "Request payment" button posts here; the endpoint resolves (or
 * creates) the inspection's invoice, marks it sent, and emails the client a pay
 * link. Tenant scope comes from the JWT, never the body.
 */
export const RequestPaymentSchema = z.object({
    inspectionId: z.string().trim().min(1).describe('Inspection whose invoice to send a payment request for'),
}).openapi('RequestPayment');

export const RequestPaymentResponseSchema = z.object({
    id: z.string().describe('Invoice row id'),
    status: z.enum(['draft', 'sent', 'partial', 'paid', 'void']).describe('Invoice status after the request (sent)'),
    amountCents: z.number().describe('Amount requested, in cents (money authority chain)'),
    sentAt: z.string().nullable().describe('ISO timestamp the request was marked sent'),
}).openapi('RequestPaymentResponse');

export const MarkInvoicePaidSchema = z.object({
    method: z.enum(['card', 'check', 'cash', 'offline', 'other']).optional()
        .describe('How the invoice was paid: card (online) or an offline method recorded by the inspector — check, cash, offline, or other.'),
}).openapi('MarkInvoicePaid');

/**
 * A payment `occurred_at` is the instant the money MOVED, never the instant the
 * row was written: an inspector takes $200 cash on Tuesday and records it on
 * Thursday, and every reporting period is quietly wrong if the two are
 * conflated. It is therefore REQUIRED on the wire — a default would make the
 * field invisible, which is the same defect wearing a nicer face.
 *
 * The tolerance is for CLIENT CLOCK SKEW, not for future-dating: the browser
 * turns the date picker's local calendar day into an absolute instant, and a
 * workstation a minute fast must not have its perfectly ordinary "today"
 * rejected. Anything genuinely ahead of now is refused.
 */
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const OCCURRED_AT = z.string().datetime({ offset: true })
    .refine((v) => Date.parse(v) <= Date.now() + FUTURE_CLOCK_SKEW_MS, {
        message: 'occurredAt must not be in the future',
    })
    .describe('ISO-8601 instant the money actually moved. Required, and must not be in the future.');

/**
 * Body of POST /api/invoices/{id}/payments — an inspector recording money that
 * already moved outside the system (cash at the door, a cheque in the post).
 *
 * `card` is deliberately NOT an accepted method here. A card payment arrives
 * from the provider carrying a reference, and a hand-entered one would create a
 * payment with no reconcilable counterpart on the processor's side.
 */
export const RecordOfflinePaymentSchema = z.object({
    amountCents: z.number().int().positive()
        .describe('Amount received on this occasion, in integer cents. Always positive; direction lives in the ledger kind.'),
    method: z.enum(['check', 'cash', 'offline', 'other'])
        .describe('How the money was received. Card is excluded: those come from the provider with a reference.'),
    occurredAt: OCCURRED_AT,
    note: z.string().trim().max(500).optional().nullable()
        .describe('Optional note kept with the ledger row, for example a cheque number.'),
    // Overpayment is real (a client rounds up) but it is far more often a
    // decimal-point typo — 20000 for 200.00. Refusing outright is wrong and
    // accepting silently is wrong; an explicit confirm is the honest middle.
    allowOverpayment: z.boolean().optional().default(false)
        .describe('Confirms an amount larger than the outstanding balance, which is usually a decimal typo.'),
}).openapi('RecordOfflinePayment');

/**
 * Body of POST /api/invoices/{id}/payments/{paymentId}/corrections.
 *
 * The ledger is append-only, so a mistyped amount is fixed by a NEW row and
 * never by editing the old one. Without this path the first typo becomes a
 * manual database edit.
 *
 * `.strict()` on purpose: a correction is the shape where a forgiving parser
 * does real damage. Anything the caller did not send must be ABSENT, not
 * quietly filled in — an unknown key here means the caller believes it is
 * changing something it is not.
 */
export const CorrectPaymentSchema = z.object({
    correctedAmountCents: z.number().int().nonnegative()
        .describe('What the payment should have been, in integer cents. Must be lower than the recorded amount.'),
    reason: z.string().trim().min(1).max(500)
        .describe('Why the original figure was wrong. Stored on the correcting row so the pair explains itself.'),
}).strict().openapi('CorrectPayment');

/**
 * One ledger row as the staff invoice surface reads it. `recordedByName` is
 * resolved server-side because "who took this money" is the question a disputed
 * payment turns on, and a bare user id cannot answer it.
 */
export const PaymentLedgerRowSchema = z.object({
    id: z.string().describe('Ledger row id; the correction endpoint takes this as its target.'),
    kind: z.enum(['deposit', 'balance', 'adjustment', 'refund'])
        .describe('Direction and nature of the movement. Refund subtracts; everything else adds.'),
    amountCents: z.number().int().describe('Amount that moved on this occasion, in integer cents. Always positive.'),
    method: z.enum(['card', 'check', 'cash', 'offline', 'other']).describe('How the money moved for this row.'),
    provider: z.string().nullable().describe('Payment provider that reported the row, or null for money recorded by hand.'),
    note: z.string().nullable().describe('Free-text note stored with the row, including a correction reason.'),
    occurredAt: z.string().describe('ISO-8601 instant the money moved, as entered by whoever recorded it.'),
    recordedBy: z.string().nullable().describe('User id that recorded the row, or null when a provider webhook wrote it.'),
    recordedByName: z.string().nullable().describe('Display name of the recording user, resolved for the ledger list.'),
    refundsId: z.string().nullable().describe('For a correction or refund, the ledger row id it reverses.'),
}).openapi('PaymentLedgerRow');

export const InvoiceResponseSchema = z.object({
    id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().trim().min(1).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    inspectionId: z.string().trim().min(1).nullable().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    clientName: z.string().nullable().describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    amountCents: z.number().describe('TODO describe amountCents field for the OpenInspection MCP integration'),
    // Cumulative amount RECEIVED — not a remaining balance. What is still owed is
    // `amountCents - amountPaidCents`, derived against our own authoritative
    // total. Null means "partial, amount unknown" (rows that predate the column,
    // or a partial the source system reported without a figure): a consumer must
    // render that as unknown, never as a zero balance.
    amountPaidCents: z.number().nullable().describe('Cumulative amount received in cents, or null when no figure was recorded'),
    lineItems: z.array(LineItemSchema).describe('TODO describe lineItems field for the OpenInspection MCP integration'),
    dueDate: z.string().nullable().describe('TODO describe dueDate field for the OpenInspection MCP integration'),
    notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    sentAt: z.string().nullable().describe('TODO describe sentAt field for the OpenInspection MCP integration'),
    paidAt: z.string().nullable().describe('TODO describe paidAt field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    status: z.enum(['draft', 'sent', 'paid', 'partial', 'void']).describe('TODO describe status field for the OpenInspection MCP integration'),
    currency: z.string().describe('ISO 4217 currency this invoice was created in (snapshot from tenant at creation).'),
}).openapi('Invoice');

/**
 * Body of GET /api/public/inspections/:id/invoice — the token-gated public pay
 * page payload (standalone `/invoice/:id` and the Hub's `?section=payment`).
 *
 * The route wraps this in `.nullable()` (no invoice yet ⇒ null data). Kept here,
 * not inline in the route, because BOTH frontend callers derive their wire type
 * from it via `z.infer`, and `app/` imports from `server/lib/**` only — a
 * schema any client type depends on must not live in `server/api/**`.
 * Previously each caller hand-copied these fields and the copies drifted
 * (`tenantSlug` landed in one of them).
 */
export const PublicInvoiceBodySchema = z.object({
    id: z.string(),
    amountCents: z.number(),
    // The payer's own record of what has already been received. Undeclared until
    // now, and because the route PARSES the row through this schema (IA-86), zod
    // stripped it — the pay page could not have shown a balance even though the
    // column was populated. Nullable: "partial, amount unknown" is a real state.
    amountPaidCents: z.number().nullable().optional(),
    // Phase B — the invoice's snapshot currency (ISO 4217); the pay page renders
    // this, not the tenant's live setting, so history stays self-describing.
    currency: z.string().optional(),
    status: z.string(),
    createdAt: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    // Deliberately NOT `LineItemSchema` — that one carries create-time input
    // constraints (min/max). This is an output shape; keep it unconstrained.
    lineItems: z.array(z.object({ description: z.string(), amountCents: z.number() })).optional(),
    brand: PublicBrandSchema.optional(),
    // IA-44 — the Hub route is slug-keyed (/portal/:tenant/i/:id) but this page
    // is not, so the payload carries the slug the post-payment hand-off needs.
    // Resolved from the GRANT's tenantId, never from anything the caller sent.
    tenantSlug: z.string().nullable().optional(),
});
