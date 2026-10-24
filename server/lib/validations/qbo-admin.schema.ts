import { z } from '@hono/zod-openapi';

/**
 * Response shapes of the QuickBooks admin routes (`server/api/qbo.ts`). They describe what the routes already
 * send; the handlers still build the bodies themselves, and the typed client reads these.
 */

const epochSeconds = (what: string) => z.number().int().describe(`${what} as epoch seconds.`);

export const QboSyncErrorSummarySchema = z.object({
    id: z.string().describe('Id of the open sync row.'),
    oiType: z.string().describe('What the row is about: invoice, refund or contact.'),
    oiId: z.string().describe('The inspection-side entity id; the bootstrap probe writes the sentinel "bootstrap".'),
    contactName: z.string().nullable().describe('Name of the contact when the row is about a contact that still exists, else null.'),
    errorCode: z.string().describe('Machine code of the failure, such as SYNC_ERROR or QBO_VOIDED_IN_QBO.'),
    message: z.string().describe('What the failure actually said.'),
    retries: z.number().int().describe('How many times this same row has been detected again.'),
    lastSeenAt: epochSeconds('When the row was last detected'),
});

export const QboPaymentDiscrepancySchema = z.object({
    id: z.string().describe('Id of the discrepancy row.'),
    invoiceId: z.string().describe('Id of the invoice where the two ledgers disagree.'),
    currency: z.string().describe('Currency code of both figures.'),
    ledgerCents: z.number().int().describe('Amount received according to this system, in integer cents.'),
    qboCents: z.number().int().describe('Amount received according to QuickBooks, in integer cents.'),
});

const origin = z.enum(['env', 'tenant', 'missing']);

export const QboConnectionStatusSchema = z.object({
    realmId: z.string().describe('The QuickBooks company (realm) id the connection belongs to.'),
    companyName: z.string().nullable().describe('Company name as QuickBooks reports it, or null when not yet read.'),
    lastSyncAt: epochSeconds('When the last payment check finished').nullable(),
    syncEnabled: z.boolean().describe('False while automatic sync is paused.'),
    openErrors: z.array(QboSyncErrorSummarySchema).describe('Open rows a person has to look at, other than payment discrepancies.'),
    paymentDiscrepancies: z.array(QboPaymentDiscrepancySchema).describe('Invoices where QuickBooks and this system disagree about payments.'),
    heldDepositCount: z.number().int().describe('Count of payments taken before an invoice existed; they are not sent to QuickBooks.'),
    refreshTokenExpiresAt: epochSeconds('When the connection must be authorised again'),
    connectedAt: epochSeconds('When the connection was first stored'),
    environment: z.enum(['sandbox', 'production']).nullable().describe('Which Intuit host this deployment calls, or null when it is not set.'),
    mappedCustomers: z.number().int().describe('Number of contacts matched to a QuickBooks customer.'),
    mappedInvoices: z.number().int().describe('Number of invoices that have a QuickBooks counterpart.'),
    credentialSource: z.object({
        clientId: origin.describe('Where the Client ID comes from; the value is never returned.'),
        clientSecret: origin.describe('Where the Client Secret comes from; the value is never returned.'),
        webhookToken: origin.describe('Where the webhook verifier token comes from; the value is never returned.'),
        environment: origin.describe('Where the environment setting comes from; the value is never returned.'),
    }).describe('The origin of each credential the connection depends on, never the credential itself.'),
});

export const QboErrorBodySchema = z.object({
    success: z.literal(false).describe('Always false on an error.'),
    error: z.object({
        code: z.string().describe('Machine readable error code.'),
        message: z.string().describe('Short message saying what went wrong.'),
        details: z.array(z.string()).optional().describe('Names of the missing settings, present only for credentials_missing.'),
    }).describe('The error.'),
});

export const QboAckSchema = z.object({ success: z.literal(true).describe('Always true on success.') });

export const QboCustomerRowSchema = z.object({
    id: z.string().describe('QuickBooks customer id.'),
    displayName: z.string().describe('Customer display name in QuickBooks.'),
    companyName: z.string().nullable().describe('Company name on the customer, if any.'),
    email: z.string().nullable().describe('Primary email on the customer, if any.'),
    phone: z.string().nullable().describe('Primary phone on the customer, if any.'),
    active: z.boolean().describe('False when the customer is inactive in QuickBooks.'),
    linkedContactId: z.string().nullable().describe('Contact of this company that already holds this customer, if any.'),
    linkedContactName: z.string().nullable().describe('Name of that contact, if any.'),
});
