/**
 * Cancelling an inspection, priced.
 *
 * Two halves, deliberately separate. `quoteCancellation` reads and computes and
 * writes NOTHING, so the same function answers "what would this cost" for the
 * confirmation screen and "what does this cost" for the write — one arithmetic,
 * not two that drift. `applyCancellationRefund` takes a quote and appends the
 * ledger row.
 *
 * The quote is scoped to the inspection's invoice. A booking deposit taken
 * before any invoice exists is representable in the ledger (`order_payments`
 * allows a null `invoice_id`) but nothing writes one today, and there would be
 * no invoice to append the reversal against — so an order with no invoice
 * quotes zero collected, which charges nothing and refunds nothing. When the
 * deposit path lands, that is the line to revisit.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, tenantConfigs } from '../../lib/db/schema';
import { inspectionServices } from '../../lib/db/schema/inspection/services';
import { invoices } from '../../lib/db/schema/invoice';
import { orderPayments } from '../../lib/db/schema/order-payment';
import { Errors } from '../../lib/errors';
import { getEffectivePriceCents } from '../../lib/effective-price';
import { classifyCancellationReason } from '../../lib/cancellation-reason';
import { resolveCancellation, type CancellationOutcome } from '../../lib/billing/cancellation-outcome';
import { estimateRetainedProcessingFeeCents } from '../../lib/billing/processing-fee';
import { getNetReceivedCents } from '../payment-ledger.service';
import { refundPartial } from '../invoice/refund';
import type { AppendedPayment } from '../payment-ledger.service';

export interface CancellationQuote {
    outcome: CancellationOutcome;
    /** The authoritative price, via the money-authority chain. */
    priceCents: number;
    /** Net received against the invoice — receipts minus refunds. */
    paidCents: number;
    /** Null when the order has no invoice; then nothing can be refunded. */
    invoiceId: string | null;
    currency: string;
    /**
     * What the tenant does NOT get back if they refund. Stripe keeps its
     * processing fee on refunds, including partial ones — refunding $50 of a
     * $100 charge still costs the merchant the full original fee. Zero unless
     * the money actually came in through Stripe; quoting a card fee against a
     * cheque would be a scarier number than the truth.
     */
    retainedProcessingFeeCents: number;
    /** False when the workspace has configured no ladder at all. */
    policyConfigured: boolean;
}

/**
 * Price a cancellation without performing one. Read-only.
 *
 * `now` is a parameter rather than `Date.now()` so the quote shown on the
 * confirmation screen and the quote taken at the write can be compared, and so
 * the notice boundary is testable at all.
 */
export async function quoteCancellation(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    reason: string,
    now: Date = new Date(),
): Promise<CancellationQuote> {
    const inspection = await db.select({
        id: inspections.id,
        priceCents: inspections.price,
        scheduledStartMs: inspections.scheduledStartMs,
    })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!inspection) throw Errors.NotFound('Inspection not found');

    const config = await db.select({
        cancellationPolicy: tenantConfigs.cancellationPolicy,
        currency: tenantConfigs.currency,
    })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();

    const invoice = await db.select({ id: invoices.id, amountCents: invoices.amountCents })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId)))
        .orderBy(desc(invoices.createdAt))
        .limit(1)
        .get();

    const serviceLines = await db.select({
        priceSnapshot: inspectionServices.priceSnapshot,
        priceOverride: inspectionServices.priceOverride,
    })
        .from(inspectionServices)
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.inspectionId, inspectionId)))
        .all();

    const priceCents = getEffectivePriceCents({
        invoiceAmountCents: invoice?.amountCents ?? null,
        serviceLines,
        inspectionPriceCents: inspection.priceCents,
    });
    const paidCents = invoice ? await getNetReceivedCents(db, tenantId, invoice.id) : 0;

    const { initiator, event } = classifyCancellationReason(reason);
    const policy = config?.cancellationPolicy ?? null;
    const outcome = resolveCancellation({
        policy,
        scheduledAt: inspection.scheduledStartMs ?? null,
        now,
        priceCents,
        paidCents,
        initiator,
        event,
    });

    const paidThroughStripe = invoice
        ? Boolean(await db.select({ id: orderPayments.id }).from(orderPayments)
            .where(and(
                eq(orderPayments.tenantId, tenantId),
                eq(orderPayments.invoiceId, invoice.id),
                eq(orderPayments.provider, 'stripe'),
            ))
            .limit(1).get())
        : false;

    return {
        outcome,
        priceCents,
        paidCents,
        invoiceId: invoice?.id ?? null,
        currency: config?.currency ?? 'USD',
        retainedProcessingFeeCents:
            outcome.refundCents > 0 && paidThroughStripe ? estimateRetainedProcessingFeeCents(paidCents) : 0,
        policyConfigured: policy !== null,
    };
}

/**
 * Append the refund a quote calls for. Returns the ledger row so the caller can
 * hand its id to an external book of record; null when there is nothing to
 * refund, which is the common case.
 */
export async function applyCancellationRefund(
    db: DrizzleD1Database,
    tenantId: string,
    quote: CancellationQuote,
    recordedBy: string | null,
): Promise<AppendedPayment | null> {
    if (quote.outcome.refundCents <= 0 || !quote.invoiceId) return null;
    return refundPartial(db, tenantId, quote.invoiceId, {
        amountCents: quote.outcome.refundCents,
        reason: `Cancellation refund (${quote.outcome.reason})`,
        recordedBy,
    });
}
