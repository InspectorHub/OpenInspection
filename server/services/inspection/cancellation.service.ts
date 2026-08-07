/**
 * Cancelling an inspection, priced.
 *
 * Two halves, deliberately separate. `quoteCancellation` reads and computes and
 * writes NOTHING, so the same function answers "what would this cost" for the
 * confirmation screen and "what does this cost" for the write — one arithmetic,
 * not two that drift. `applyCancellationRefund` takes a quote and appends the
 * ledger row.
 *
 * WHAT WAS COLLECTED IS NOT THE SAME AS WHAT THE INVOICE RECEIVED. A booking
 * deposit is money the client has actually paid, sitting against the ORDER with
 * a null `invoice_id` because no invoice exists yet. It counts toward
 * `paidCents`, and the reason is the whole point of the deposit feature: a
 * no-show on a booking that was never invoiced is EXACTLY the case a deposit is
 * for, and excluding it would hand the resolver `paidCents: 0`, cap the no-show
 * fee at nothing, and leave the money held forever with nobody told. The
 * feature would be inert precisely where it was supposed to bite.
 *
 * THE TWO POOLS ARE NORMALLY DISJOINT, which is what makes the refund routing
 * simple: raising an invoice backfills `invoice_id` onto the deposit rows, so
 * the held total drops to zero and the invoice's own total picks it up. They
 * overlap only when a webhook lands after the invoice was raised, and the apply
 * step below handles that case rather than assuming it away.
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
import { getNetReceivedCents, getHeldDepositCents } from '../payment-ledger.service';
import { refundPartial, refundHeldDeposit } from '../invoice/refund';
import type { AppendedPayment } from '../payment-ledger.service';

export interface CancellationQuote {
    outcome: CancellationOutcome;
    /** The authoritative price, via the money-authority chain. */
    priceCents: number;
    /** Everything collected on this order — the invoice's receipts PLUS anything still held. */
    paidCents: number;
    /**
     * The part of `paidCents` that has no invoice behind it. Carried because the
     * two pools need different writers to send money back, and the caller must
     * not have to re-derive which is which.
     */
    heldDepositCents: number;
    /** Null when the order has no invoice. Money can still be held against it. */
    invoiceId: string | null;
    /** The order the quote is about — the refund writers need it, invoice or not. */
    inspectionId: string;
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
    const invoiceReceivedCents = invoice ? await getNetReceivedCents(db, tenantId, invoice.id) : 0;
    const heldDepositCents = await getHeldDepositCents(db, tenantId, inspectionId);
    const paidCents = invoiceReceivedCents + heldDepositCents;

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

    // Scoped to the ORDER, not the invoice: a booking deposit is the most likely
    // card payment on a job cancelled before invoicing, and looking only at
    // invoice-attached rows would quote a zero processing loss on exactly the
    // cancellation where Stripe has kept its fee.
    const paidThroughStripe = paidCents > 0 && Boolean(
        await db.select({ id: orderPayments.id }).from(orderPayments)
            .where(and(
                eq(orderPayments.tenantId, tenantId),
                eq(orderPayments.inspectionId, inspectionId),
                eq(orderPayments.provider, 'stripe'),
            ))
            .limit(1).get(),
    );

    return {
        outcome,
        priceCents,
        paidCents,
        heldDepositCents,
        invoiceId: invoice?.id ?? null,
        inspectionId,
        currency: config?.currency ?? 'USD',
        retainedProcessingFeeCents:
            outcome.refundCents > 0 && paidThroughStripe ? estimateRetainedProcessingFeeCents(paidCents) : 0,
        policyConfigured: policy !== null,
    };
}

/**
 * What `applyCancellationRefund` did, in the shape its caller has to push.
 * Not exported: the only consumer is the cancel route, which reaches it through
 * the function's return type and never needs to name it.
 */
interface AppliedCancellationRefund {
    /** The ledger row an external book of record keys its credit memo on. */
    row: AppendedPayment;
    /**
     * The invoice `row` reverses — or NULL when the money came back off a held
     * deposit, which has no invoice.
     *
     * Null is an instruction, not a missing field: do not post this to
     * QuickBooks. An unapplied deposit was never pushed there in the first
     * place (no invoice, so no QBO Invoice and no Payment), so a credit memo
     * would credit the customer for revenue QuickBooks never recorded and
     * understate the tenant's income by the refund. The right instrument is a
     * refund receipt against a customer-deposit LIABILITY account, which is a
     * choice in the tenant's chart of accounts and not ours to invent. The gap
     * is disclosed as a count in the Books health card instead.
     */
    invoiceId: string | null;
}

/**
 * Append the refund a quote calls for. Returns the ledger row so the caller can
 * hand its id to an external book of record; null when there is nothing to
 * refund, which is the common case.
 *
 * TWO WRITERS, because the money can sit in two places and only one of them has
 * an invoice to reverse against. Invoice-attached money goes back through
 * `refundPartial`, which recomputes that invoice's cached totals; a held deposit
 * goes back through `refundHeldDeposit`, which has no invoice to recompute.
 * Neither was bent to cover the other's case — see the header of
 * `../invoice/refund` for why that would be one name over two functions.
 *
 * The invoice is drained FIRST when both hold money. Not arbitrary: the
 * invoice's `amount_paid_cents` is a cached figure a human reads off the invoice
 * screen, and leaving it overstated while the refund came out of an invisible
 * held pool is the "cash in one place and not the other" failure this task
 * exists to avoid.
 *
 * Returns the invoice row when both fire, and says which invoice it belongs to
 * so the caller does not have to re-derive the split to know whether the row is
 * postable. A held-deposit refund comes back with a null `invoiceId` rather
 * than being withheld: the cancel response still has to name the row it
 * appended, and only the push is off-limits.
 */
export async function applyCancellationRefund(
    db: DrizzleD1Database,
    tenantId: string,
    quote: CancellationQuote,
    recordedBy: string | null,
): Promise<AppliedCancellationRefund | null> {
    const owed = quote.outcome.refundCents;
    if (owed <= 0) return null;

    const reason = `Cancellation refund (${quote.outcome.reason})`;
    const invoiceReceivedCents = quote.paidCents - quote.heldDepositCents;
    const fromInvoice = quote.invoiceId ? Math.min(owed, invoiceReceivedCents) : 0;
    const fromHeld = owed - fromInvoice;

    const invoiceRow = fromInvoice > 0 && quote.invoiceId
        ? await refundPartial(db, tenantId, quote.invoiceId, { amountCents: fromInvoice, reason, recordedBy })
        : null;
    const heldRow = fromHeld > 0
        ? await refundHeldDeposit(db, tenantId, quote.inspectionId, { amountCents: fromHeld, reason, recordedBy })
        : null;

    if (invoiceRow) return { row: invoiceRow, invoiceId: quote.invoiceId };
    if (heldRow) return { row: heldRow, invoiceId: null };
    return null;
}
