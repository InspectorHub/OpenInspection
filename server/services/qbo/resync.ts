import { and, asc, eq, exists, isNull, notExists, sql } from 'drizzle-orm';
import { invoices } from '../../lib/db/schema/invoice';
import { qboEntityMap, qboSyncErrors } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import type { QBOServiceBase } from './api-base';
import { noCustomerFailureMessage } from './invoice-payload';

type Db = ReturnType<QBOServiceBase['getDrizzle']>;

/**
 * How many invoices one match may push. Each push costs about ten database
 * calls and one or two calls to QuickBooks. The work runs after the response, in
 * the request's background allowance, and a single QuickBooks call that is rate
 * limited can wait up to half a minute, so the count stays small and a clock
 * budget (below) stops the loop early. Sequential on purpose -- a parallel burst
 * would hit QuickBooks' own rate limit sooner.
 */
export const RESYNC_INVOICE_LIMIT = 10;

/** Stop starting new pushes after this long; the rest are counted as remaining. */
const RESYNC_BUDGET_MS = 20_000;

/** A ceiling on what a caller may ask for, so a bad argument cannot lift the cap. */
const RESYNC_INVOICE_CEILING = 50;

/** The two things the re-sync needs from the QuickBooks service. */
export interface ResyncDeps {
    getDrizzle: () => Db;
    upsertInvoice: (
        tenantId: string,
        invoice: {
            id: string;
            invoiceNumber?: number | null;
            contactId?: string | null;
            dueDate?: string | null;
            lineItems: Array<{ description: string; amountCents: number; quantity?: number }>;
            amountCents: number;
            status: string;
        },
    ) => Promise<void>;
}

export interface ResyncResult {
    attempted: number;
    succeeded: number;
    failed: number;
    /**
     * Invoices that still qualify but were beyond the limit or the time budget.
     * Nothing retries them on a schedule: they are pushed the next time the
     * contact is matched again, or when the invoice itself is sent again.
     */
    remaining: number;
}

/**
 * Push again the invoices of ONE contact that failed because that contact had no
 * QuickBooks customer -- which a match has just given it.
 *
 * "Failed for that reason" is read off the open item the push left behind (same
 * text, same invoice), not guessed from the status alone: an invoice that failed
 * for any other cause would fail again for that cause and only add noise. Every
 * query carries the company, and the contact is only ever one of that company's.
 *
 * Nothing here can create an invoice twice. An invoice that already has a
 * QuickBooks twin is excluded by the query, and once a push succeeds it has one,
 * so a second match finds nothing left to do. `upsertInvoice` itself updates
 * rather than creates when a twin exists.
 */
export async function resyncInvoicesForContact(
    deps: ResyncDeps,
    tenantId: string,
    contactId: string,
    limit: number = RESYNC_INVOICE_LIMIT,
    clock: { now: () => number; budgetMs: number } = { now: Date.now, budgetMs: RESYNC_BUDGET_MS },
): Promise<ResyncResult> {
    const startedAt = clock.now();
    const db = deps.getDrizzle();
    const max = Math.min(RESYNC_INVOICE_CEILING, Math.max(0, Math.floor(limit)));

    const qualifying = and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.contactId, contactId),
        isNull(invoices.voidedAt),
        // A paid or part-paid invoice would reach QuickBooks as an unpaid one,
        // because only the document is pushed, not the payment.
        isNull(invoices.paidAt),
        isNull(invoices.partialPaidAt),
        eq(invoices.qboSyncStatus, 'failed'),
        notExists(db.select({ one: sql`1` }).from(qboEntityMap).where(and(
            eq(qboEntityMap.tenantId, tenantId),
            eq(qboEntityMap.oiType, 'invoice'),
            eq(qboEntityMap.oiId, invoices.id),
        ))),
        exists(db.select({ one: sql`1` }).from(qboSyncErrors).where(and(
            eq(qboSyncErrors.tenantId, tenantId),
            eq(qboSyncErrors.oiType, 'invoice'),
            eq(qboSyncErrors.oiId, invoices.id),
            eq(qboSyncErrors.errorCode, 'SYNC_ERROR'),
            eq(qboSyncErrors.errorMsg, noCustomerFailureMessage(contactId)),
            eq(qboSyncErrors.resolved, false),
        ))),
    );

    const total = (await db.select({ n: sql<number>`count(*)` }).from(invoices).where(qualifying).get())?.n ?? 0;
    const rows = max === 0 ? [] : await db.select().from(invoices).where(qualifying)
        .orderBy(asc(invoices.createdAt), asc(invoices.id)).limit(max).all();

    let succeeded = 0;
    let failed = 0;
    let attempted = 0;
    for (const row of rows) {
        if (clock.now() - startedAt > clock.budgetMs) break;
        attempted += 1;
        try {
            await deps.upsertInvoice(tenantId, {
                id:            row.id,
                invoiceNumber: row.invoiceNumber,
                contactId:     row.contactId,
                dueDate:       row.dueDate,
                lineItems:     row.lineItems,
                amountCents:   row.amountCents,
                // The push only distinguishes "sent" (it asks QuickBooks to
                // email the document) from everything else.
                status:        row.sentAt ? 'sent' : 'draft',
            });
        } catch (err) {
            // `upsertInvoice` records its own failures; a throw out of it is
            // something it did not expect, and is only logged here.
            logger.error('QBO re-sync after match: invoice push threw', { tenantId, invoiceId: row.id }, err instanceof Error ? err : undefined);
        }
        // The push reports its outcome by writing it, not by returning it.
        const after = await db.select({ status: invoices.qboSyncStatus }).from(invoices)
            .where(and(eq(invoices.id, row.id), eq(invoices.tenantId, tenantId))).get();
        if (after?.status === 'synced') {
            succeeded += 1;
            await db.update(qboSyncErrors).set({ resolved: true, updatedAt: new Date(), resolvedAt: new Date() }).where(and(
                eq(qboSyncErrors.tenantId, tenantId),
                eq(qboSyncErrors.oiType, 'invoice'),
                eq(qboSyncErrors.oiId, row.id),
                eq(qboSyncErrors.errorCode, 'SYNC_ERROR'),
                eq(qboSyncErrors.resolved, false),
            ));
        } else {
            failed += 1;
        }
    }

    return { attempted, succeeded, failed, remaining: Math.max(0, total - attempted) };
}
