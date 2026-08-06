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

/**
 * WHAT THE MONEY IS FOR, stamped on the intent and read back off the webhook.
 *
 * This exists because `metadata.invoiceId` was doing two jobs: naming the
 * invoice AND being the signal that a settlement is ours to act on. A booking
 * deposit is taken before any invoice exists, so under that rule its webhook
 * read as "nothing to do" — the handler logged `received`, ACKed, and the
 * deposit row was never written. Money in Stripe, nothing in the ledger, and
 * no surface anywhere saying so.
 *
 * So the KIND is the discriminator and the id follows from it. A future intent
 * that is neither adds an arm here, and the webhook's switch stops compiling
 * until it is handled — which is the property `invoiceId`-or-nothing could not
 * offer.
 *
 * Intents minted before this field existed carry no `kind`; they are read as
 * `invoice`, which is what they all were.
 */
// Not exported: consumers narrow on `settled.purpose.kind` structurally, and an
// exported name nothing imports is dead surface the knip gate is right to flag.
type PaymentPurpose =
    | { kind: 'invoice'; invoiceId: string }
    | { kind: 'deposit'; inspectionId: string };

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
        kind: 'invoice',
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

/** Raised when there is nothing to collect up front, or it is already collected. */
export class DepositNotPayableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DepositNotPayableError';
    }
}

/**
 * Builds the PaymentIntent params for a booking DEPOSIT — money against an
 * order, before any invoice exists.
 *
 * Not a variant of `buildPaymentIntentParams`: that function's whole job is to
 * refuse to charge without a payable invoice, and loosening it so a deposit
 * could pass would remove the guard for every real invoice too. Two callers,
 * two guards, one webhook that can tell them apart.
 *
 * `outstandingCents` is what is still owed of the deposit, not the deposit
 * itself: a booker who abandoned the card form and came back must not be
 * charged the whole amount twice.
 */
export function buildDepositIntentParams(
    order: { inspectionId: string; outstandingCents: number },
    ctx: { tenantId: string; currency?: string; descriptionPrefix?: string },
): PaymentIntentParams {
    if (!Number.isInteger(order.outstandingCents) || order.outstandingCents <= 0) {
        throw new DepositNotPayableError('No deposit is outstanding on this booking');
    }
    return {
        amount: order.outstandingCents,
        currency: (ctx.currency ?? 'usd').toLowerCase(),
        metadata: {
            kind: 'deposit',
            inspectionId: order.inspectionId,
            tenantId: ctx.tenantId,
        },
        description: `${ctx.descriptionPrefix ?? 'Booking deposit'} ${order.inspectionId}`,
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

/**
 * A settlement we recognise. `tenantId` and the amount are common to both
 * arms; `purpose` says which ledger row it becomes.
 *
 * `amountCents` is read off the EVENT, not off our own record: for a deposit
 * there is no invoice to look the figure up on, and for a partial card payment
 * the amount that settled is the amount Stripe says settled. `providerRef` is
 * the intent id — the idempotency key a redelivery collides on.
 */
export interface SettledPayment {
    tenantId: string;
    purpose: PaymentPurpose;
    /** The intent id. Null only if Stripe sent an object without one. */
    providerRef: string | null;
    /** What actually settled, in the smallest currency unit. */
    amountCents: number;
    /** Present on both arms when known; the deposit arm always has it. */
    inspectionId: string | null;
}

/**
 * Extracts the settlement from a Stripe webhook event, or null when there is
 * nothing for us to act on — a non-success event, an intent minted by
 * something other than this app, or metadata we cannot make sense of. The
 * handler treats null as "log it and ACK".
 *
 * NULL IS NOT A SAFE DEFAULT HERE, which is why the parsing is explicit rather
 * than a chain of `??`. Returning null for a settlement that IS ours means the
 * money moved and no row records it, and the only trace is a `received` line
 * in a log nobody reads. That is exactly what happened to deposits before
 * `kind` existed.
 */
export function extractSettledPayment(event: StripeEventLike): SettledPayment | null {
    if (event.type !== 'payment_intent.succeeded') return null;
    const obj = event.data?.object as {
        id?: string;
        amount_received?: number;
        amount?: number;
        metadata?: Record<string, string> | null;
    } | undefined;
    const md = obj?.metadata ?? null;
    if (!md) return null;
    const tenantId = md.tenantId;
    if (!tenantId) return null;

    // Absent `kind` means an intent minted before the field existed, and every
    // one of those was an invoice payment.
    const kind = md.kind ?? 'invoice';
    const inspectionId = md.inspectionId ?? null;
    // `amount_received` is what settled; `amount` is what was asked for. They
    // differ on a partial capture, and the ledger records what arrived.
    const amountCents = Number(obj?.amount_received ?? obj?.amount ?? 0);
    const providerRef = obj?.id ?? null;

    if (kind === 'deposit') {
        if (!inspectionId) return null;
        return { tenantId, purpose: { kind: 'deposit', inspectionId }, providerRef, amountCents, inspectionId };
    }
    if (kind === 'invoice') {
        if (!md.invoiceId) return null;
        return { tenantId, purpose: { kind: 'invoice', invoiceId: md.invoiceId }, providerRef, amountCents, inspectionId };
    }
    // A kind this build does not know about. Refusing it is right — guessing
    // would post money against the wrong thing — but it must not be silent.
    return null;
}
