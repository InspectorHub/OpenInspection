// Cancellation sub-router: the whole cancellation AXIS, both directions — the
// priced quote, the cancel write that applies it, and the one door back out of
// `cancelled` (#81). Split out of ./publish.ts, which was at its size ceiling
// and which owns the report lifecycle rather than the cancellation state.
//
// `/{id}/uncancel` joined it later, from the same file and for the same reason:
// recovery is not a report-lifecycle event, and the refusals every other writer
// now returns (./cancel-write-path) point HERE. Keeping the two directions in
// one module is what stops them drifting apart again — that drift is the whole
// of #81.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { assertStaffMayCancel, guardStaffUncancel } from './staff-status-guards';
import { capabilitiesFor } from '../../lib/middleware/require-capability';
import { moneyView } from '../../lib/auth/money-access';
import { Errors } from '../../lib/errors';
import { CancelInspectionSchema } from '../../lib/validations/inspection.schema';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { CANCELLATION_REASONS } from '../../lib/cancellation-reason';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { auditFromContextAwaited } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { pushInspectionAfterResponse } from '../../lib/calendar/push-hooks';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { quoteCancellation, applyCancellationRefund } from '../../services/inspection/cancellation.service';

const CancellationQuoteSchema = z.object({
    feeCents: z.number().int().describe('Kept by the company. Never exceeds what was collected.'),
    refundCents: z.number().int().describe('Returned to the payer.'),
    reason: z.string().describe('Machine code for WHY, e.g. late_cancellation. Render it in the reader language.'),
    cappedAtCollected: z.boolean().describe('The ladder asked for more than was collected and the charge was reduced.'),
    priceCents: z.number().int().describe('Authoritative inspection price; a percent fee is a share of this.'),
    paidCents: z.number().int().describe('Net received against the invoice.'),
    currency: z.string().describe('ISO 4217 for every figure here.'),
    retainedProcessingFeeCents: z.number().int()
        .describe('Estimated processing fee Stripe keeps on the refund. Not recoverable. Zero for non-card money.'),
    policyConfigured: z.boolean().describe('False when the workspace has configured no ladder; nothing is ever charged.'),
}).openapi('CancellationQuote');

// What a caller WITHOUT the inspection-fees capability gets from the quote: no figure
// at all. `moneyInvolved` is a yes/no, not an amount - it lets the dialog offer
// a plain cancellation when nothing was collected or charged, and say who may
// cancel when something was.
const RestrictedQuoteSchema = z.object({
    requiresFinancial: z.literal(true).describe('The caller lacks the inspection-fees capability, so no amount is returned.'),
    moneyInvolved: z.boolean().describe('True when a fee, a refund or a collected payment is attached to this cancellation.'),
}).openapi('CancellationQuoteRestricted');

// The cancel answer as a caller without the inspection-fees capability receives it:
// the same outcome with every amount absent.
const CancellationOutcomeSchema = CancellationQuoteSchema.partial({
    feeCents: true, refundCents: true, priceCents: true, paidCents: true, retainedProcessingFeeCents: true,
}).openapi('CancellationOutcome');

const quoteRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/cancellation-quote',
    tags: ['inspections'],
    summary: 'Price a cancellation without performing one',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id.') }),
        query: z.object({
            reason: z.enum(CANCELLATION_REASONS).describe('The reason that would be recorded; it decides the outcome.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.union([CancellationQuoteSchema, RestrictedQuoteSchema]),
            }) } },
            description: 'The computed outcome, or only requiresFinancial and moneyInvolved for a caller without the inspection-fees capability. Read-only — nothing is cancelled and no money moves.',
        },
    },
    operationId: 'getCancellationQuote',
    description: 'Computes the fee, the refund and the reason a cancellation would produce, so whoever cancels sees the result before confirming it. Read-only.',
}, { scopes: ['read'], tier: 'extended' }));

const cancelRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['inspections'],
    summary: 'Cancel inspection for current tenant',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id.') }),
        body: { content: { 'application/json': { schema: CancelInspectionSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.object({
                    outcome: CancellationOutcomeSchema,
                    refundPaymentId: z.string().nullable()
                        .describe('Ledger row id of the refund appended, or null when nothing was refunded. An external book of record keys its credit memo on THIS, not on the invoice.'),
                }),
            }) } },
            description: 'Cancelled',
        },
        409: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(false),
                error: z.object({
                    code: z.literal('CANCELLATION_FEE_NEEDS_CONFIRM'),
                    message: z.string(),
                    quote: CancellationQuoteSchema,
                }),
            }) } },
            description: 'This cancellation carries a fee the caller has not acknowledged. Show the quote and resend with acknowledgedFeeCents.',
        },
    },
    operationId: 'cancelInspection',
    description: 'Cancels an inspection and applies the tenant cancellation policy: keeps the fee the policy allows and appends the refund to the payment ledger. Refuses to charge a fee the caller has not acknowledged. Available to owner, manager and inspector roles. Staff may cancel only an unpaid inspection that has not started, and need scheduleOthers or a place on the inspection; otherwise they get 403.',
}, { scopes: ['write'], tier: 'extended' }));

// THE ONE DOOR BACK (#81). This endpoint shipped complete and unwired: the
// product's only recovery was the list row's status dropdown, PATCHing a new
// status straight on. Two doors for one idea, disagreeing — the PATCH audited
// the change and re-pushed Google Calendar, this did neither; the bulk door
// cleared nothing at all. Rather than adopt the weaker of them, the two things
// this was missing moved into it and the others now refuse (./cancel-write-path).
//
// ROLE MATCHES `POST /{id}/cancel` above, deliberately widened from
// owner+manager. An inspector standing at a door nobody answered may cancel; a
// stricter gate on the way back would make their own mis-click the one thing
// they cannot undo.
const uncancelRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/uncancel',
    tags: ["inspections"], summary: "Bring a cancelled inspection back",
    middleware: [requireRole('owner', 'manager', 'inspector'), guardStaffUncancel] as const,
    request: { params: z.object({ id: z.string().describe('The cancelled inspection to bring back.') }).describe('Path parameters.') },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('Recovered.') } }, description: 'Uncancelled' },
        400: { description: 'The inspection is not cancelled, so there is nothing to recover.' },
    },
    operationId: "createInspectionUncancel",
    description: "Returns a mistakenly-cancelled inspection to the status it had before it was cancelled, clears the recorded cancellation reason and notes, and restores the lead inspector's Google Calendar entry. The report status is not changed. Staff need scheduleOthers or a place on the inspection, and get 403 for an inspection that was completed when it was cancelled. Does NOT reverse a cancellation fee or a refund: both are already ledger entries, and undoing them is an invoice adjustment."
}, { scopes: ['write'], tier: 'extended' }));

const flatten = (q: Awaited<ReturnType<typeof quoteCancellation>>) => ({
    ...q.outcome,
    priceCents: q.priceCents,
    paidCents: q.paidCents,
    currency: q.currency,
    retainedProcessingFeeCents: q.retainedProcessingFeeCents,
    policyConfigured: q.policyConfigured,
});

// A cancellation touches money when anything was collected or would be charged or returned.
const involvesMoney = (q: Awaited<ReturnType<typeof quoteCancellation>>) =>
    q.paidCents > 0 || q.outcome.feeCents > 0 || q.outcome.refundCents > 0;

const cancellationRoutes = createApiRouter()
    .openapi(quoteRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { reason } = c.req.valid('query');
        const quote = await quoteCancellation(getDrizzle(c), tenantId, id, reason);
        if (!(await capabilitiesFor(c)).inspectionFees) {
            return c.json({ success: true as const, data: { requiresFinancial: true as const, moneyInvolved: involvesMoney(quote) } }, 200);
        }
        return c.json({ success: true as const, data: flatten(quote) }, 200);
    })
    .openapi(cancelRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { reason, notes, acknowledgedFeeCents } = c.req.valid('json');
        const db = getDrizzle(c);

        // Quoted BEFORE the status write, because the notice window is measured
        // against the scheduled instant and the outcome must describe the state
        // the caller was looking at.
        const quote = await quoteCancellation(db, tenantId, id, reason);

        // Staff cancel only what nothing has been collected on and the inspector has not started.
        await assertStaffMayCancel(c, id, quote.paidCents);

        // Committing a fee or a refund is a money decision. The refusal carries no
        // figure, and it comes before the fee confirmation, which would show one.
        if (involvesMoney(quote) && !(await capabilitiesFor(c)).inspectionFees) {
            throw Errors.FinancialRequired('cancellation', 'inspectionFees');
        }

        // A cancellation that silently charges 50% is a chargeback. Making the
        // acknowledgement a SERVER rule rather than a UI convention is what
        // stops the next surface — a bulk action, an MCP tool, a mobile client
        // — from skipping the confirmation screen and charging anyway.
        if (quote.outcome.feeCents > 0 && acknowledgedFeeCents !== quote.outcome.feeCents) {
            return c.json({
                success: false as const,
                error: {
                    code: 'CANCELLATION_FEE_NEEDS_CONFIRM' as const,
                    message: 'This cancellation carries a fee under your cancellation policy. Confirm the amount shown to continue.',
                    quote: flatten(quote),
                },
            }, 409);
        }

        const from = await c.var.services.inspection.cancelInspection(tenantId, id, reason, notes);

        const userId = (c.get('user') as { sub?: string } | undefined)?.sub ?? null;
        const refund = await applyCancellationRefund(db, tenantId, quote, userId);

        // #78 — INHERITED FROM THE DOOR THAT CLOSED. `PATCH /{id}` used to be a
        // second way to cancel, and it carried two things this route did not:
        // it took the job off the lead inspector's Google Calendar
        // (pushInspectionToGoogle deletes the entry once the row reads
        // 'cancelled'), and it wrote the status change to the audit log.
        // Refusing 'cancelled' there without moving these here would have
        // traded a billing hole for a cancelled inspection that still occupies
        // an inspector's Monday and left no record of who cancelled it.
        //
        // The audit metadata names the money, because that is the part of a
        // cancellation nobody can reconstruct from the row afterwards.
        pushInspectionAfterResponse(c, tenantId, id);
        // AWAITED, not fire-and-forget: `from` is the only durable record of the status this job had, and a
        // restore reads it back. The money has already moved, so a failed write is logged, not turned into a 500.
        await auditFromContextAwaited(c, 'inspection.status_change', 'inspection', {
            entityId: id,
            metadata: {
                from,
                to: 'cancelled',
                reason,
                feeCents: quote.outcome.feeCents,
                refundCents: quote.outcome.refundCents,
                refundPaymentId: refund?.row.id ?? null,
            },
        }).catch((e) => logger.error('cancel audit write failed', { inspectionId: id }, e instanceof Error ? e : undefined));

        // THE SEAM. All three refund writers reach money through
        // `applyCancellationRefund`, and this is the only production entry to
        // it, so one push here covers every refund that exists — rather than a
        // push inside each writer, where `server/services/invoice/refund.ts` has
        // no QBO service, no `env` and no `executionCtx`, and where an outbound
        // HTTP call would sit inside the refund's own path.
        //
        // `waitUntil` is what makes the non-negotiable structural: the refund
        // row is already committed above, and QuickBooks being down can only
        // lose the memo, never the refund. `createCreditMemo` catches and files
        // a sync error besides, so the tenant is told rather than the failure
        // vanishing.
        //
        // `invoiceId` null means a held deposit — see AppliedCancellationRefund
        // for why that one is not postable, and is not silently postable either.
        if (c.env.QBO_CLIENT_ID && refund?.invoiceId) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.createCreditMemo(
                    tenantId, refund.invoiceId,
                    // DOLLARS. The QBO payload puts this straight on Line[0].Amount.
                    refund.row.amountCents / 100,
                    refund.row.id, refund.row.occurredAt,
                ),
            );
        }

        return c.json({
            success: true as const,
            data: await moneyView(c, { outcome: flatten(quote), refundPaymentId: refund?.row.id ?? null }, 'inspectionFees'),
        }, 200);
    })
    .openapi(uncancelRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const restored = await c.var.services.inspection.uncancelInspection(tenantId, id);

        // Both of these are what the dropdown's PATCH did and this did not.
        // The calendar entry was REMOVED by the cancel — pushInspectionToGoogle
        // re-reads the row and puts it back, same call, no case analysis here.
        pushInspectionAfterResponse(c, tenantId, id);
        // Awaited like the cancel row: it marks the cancellation it ends as spent (see `recordedStatusBeforeCancel`).
        await auditFromContextAwaited(c, 'inspection.status_change', 'inspection', {
            entityId: id,
            metadata: { from: INSPECTION_STATUS.CANCELLED, to: restored },
        }).catch((e) => logger.error('restore audit write failed', { inspectionId: id }, e instanceof Error ? e : undefined));
        return c.json({ success: true });
    });

// No `...Api` type export: no sibling inspection sub-router has one, and the
// merged RPC type is published by `server/api/inspections.ts`.
export default cancellationRoutes;
