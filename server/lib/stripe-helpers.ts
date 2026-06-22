/**
 * Pure helpers for the Stripe bring-your-own-keys payment flow.
 *
 * Deliberately free of any SDK import so the money-handling logic
 * (amount mapping, payable guards, webhook metadata extraction) is fully
 * unit-testable in Node without touching Stripe or the Worker runtime.
 */

/** The minimal invoice shape the payment flow needs. */
export interface PayableInvoice {
    id: string;
    amountCents: number;
    inspectionId?: string | null;
    /** Derived status from InvoiceService.getStatus ('draft'|'sent'|'paid'|'partial'). */
    status?: string;
    paidAt?: unknown;
}

export interface PaymentIntentParams {
    /** Amount in the currency's smallest unit (cents for USD). */
    amount: number;
    currency: string;
    metadata: Record<string, string>;
    description: string;
}

/** Raised when an invoice cannot be charged (already paid, or no positive amount). */
export class InvoiceNotPayableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvoiceNotPayableError';
    }
}

/**
 * Builds the Stripe PaymentIntent params for an invoice. Throws
 * InvoiceNotPayableError when the invoice is already settled or has no
 * positive amount, so the caller never creates a charge for $0 or a
 * double-payment.
 */
export function buildPaymentIntentParams(
    invoice: PayableInvoice,
    ctx: { tenantId: string; currency?: string; descriptionPrefix?: string },
): PaymentIntentParams {
    if (invoice.status === 'paid' || invoice.paidAt) {
        throw new InvoiceNotPayableError('Invoice already paid');
    }
    if (invoice.status === 'void') {
        throw new InvoiceNotPayableError('Invoice is void');
    }
    if (!Number.isInteger(invoice.amountCents) || invoice.amountCents <= 0) {
        throw new InvoiceNotPayableError('Invoice has no payable amount');
    }

    const metadata: Record<string, string> = {
        invoiceId: invoice.id,
        tenantId: ctx.tenantId,
    };
    if (invoice.inspectionId) metadata.inspectionId = invoice.inspectionId;

    return {
        amount: invoice.amountCents,
        currency: (ctx.currency ?? 'usd').toLowerCase(),
        metadata,
        description: `${ctx.descriptionPrefix ?? 'Invoice'} ${invoice.id}`,
    };
}

/**
 * The subset of a Stripe.Event we read in the webhook. `data.object` is typed
 * `unknown` because the real Stripe.Event is a wide discriminated union whose
 * object shape varies per event type — we narrow to the metadata bag inside.
 */
export interface StripeEventLike {
    type: string;
    data: { object: unknown };
}

export interface SettledPayment {
    invoiceId: string;
    tenantId: string;
    inspectionId: string | null;
}

/**
 * Extracts the settled invoice reference from a Stripe webhook event.
 * Returns null for any event that is not a successful PaymentIntent or that
 * is missing the invoiceId/tenantId metadata we stamped at creation time —
 * the webhook handler treats null as "nothing to do" and acks the event.
 */
export function extractSettledPayment(event: StripeEventLike): SettledPayment | null {
    if (event.type !== 'payment_intent.succeeded') return null;
    const obj = event.data?.object as { metadata?: Record<string, string> | null } | undefined;
    const md = obj?.metadata ?? null;
    if (!md) return null;
    const invoiceId = md.invoiceId;
    const tenantId = md.tenantId;
    if (!invoiceId || !tenantId) return null;
    return { invoiceId, tenantId, inspectionId: md.inspectionId ?? null };
}
