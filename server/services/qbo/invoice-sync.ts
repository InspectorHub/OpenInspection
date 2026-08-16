import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap } from '../../lib/db/schema/qbo';
import { invoices } from '../../lib/db/schema/invoice';
import { contacts } from '../../lib/db/schema/contact';
import { logger } from '../../lib/logger';
import type {
    Constructor,
    InvoiceSummary,
    MarkPaidFn,
    MarkPartialFn,
    QBOServiceBase,
} from './api-base';
import { describeQboError } from './api-base';
import { applyInvoiceStatusFromQBO } from './inbound-reconcile';
import { billableLines, toQboLines, buildInvoicePayload } from './invoice-payload';
import type { CustomerSyncSurface } from './customer-sync';
import { withPaymentSync } from './payment-sync';

/**
 * The base must already carry `withCustomerSync`.
 *
 * That is a real requirement, not documentation: `upsertInvoice` creates a
 * missing QuickBooks customer on demand, so it calls down into that mixin. The
 * constraint is on the type parameter so `qbo.service.ts` composing the mixins
 * in the wrong order is a build error, rather than a
 * `this.upsertCustomer is not a function` raised the first time a tenant with an
 * unmapped contact raises an invoice — which is to say, in production, for the
 * exact case this ordering exists to serve.
 */
export function withInvoiceSync<
    TBase extends Constructor<QBOServiceBase & CustomerSyncSurface>,
>(Base: TBase) {
    // `withPaymentSync` carries `txnDateFor`, `getQBOCustomerIdForInvoice` and
    // `findQboCustomerId` — the lookups both halves share.
    return class extends withPaymentSync(Base) {
        public buildDocNumber(invoiceNumber: string): string {
            return invoiceNumber.slice(0, 21);
        }

        public async applyInvoiceStatusFromQBO(
            tenantId: string,
            inv: InvoiceSummary,
            markPaid: MarkPaidFn,
            markPartial: MarkPartialFn,
        ): Promise<boolean> {
            return applyInvoiceStatusFromQBO(this.getDrizzle(), tenantId, inv, markPaid, markPartial, {
                clearPaymentDiscrepancy:  (t, i) => this.clearPaymentDiscrepancy(t, i),
                recordPaymentDiscrepancy: (t, i, l, q) => this.recordPaymentDiscrepancy(t, i, l, q),
                noteVoidedInQuickBooks:   (t, i) => this.noteVoidedInQuickBooks(t, i),
            });
        }

        async upsertInvoice(
            tenantId: string,
            invoice: {
                id: string;
                invoiceNumber?: string | null;
                contactId?: string | null;
                dueDate?: string | null;
                lineItems: Array<{ description: string; amountCents: number; quantity?: number }>;
                /**
                 * The invoice total. Authoritative per the money authority
                 * chain, and the only thing there is to bill when the invoice
                 * carries no itemisation — see the `Line` fallback below.
                 */
                amountCents: number;
                status: string;
            },
        ): Promise<void> {
            const db = this.getDrizzle();
            const conn = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
            if (!conn) return;

            let qboCustomerId: string | null = null;
            if (invoice.contactId) {
                qboCustomerId = await this.findQboCustomerId(tenantId, invoice.contactId);
                // Not mapped yet — create the customer now rather than refuse.
                //
                // Nothing else ever would. `upsertCustomer` is reached from the
                // contact create and update endpoints and from nowhere else, so
                // every contact that existed BEFORE QuickBooks was connected has
                // no twin, and the refusal below turned that into "no invoice
                // this company has ever raised can be sent" — the ordinary
                // onboarding path, where a company arrives with a client list
                // already in the product. Editing each contact to trigger a push
                // was the only cure, and nothing said so.
                //
                // Creating on demand is also what the field does: Jobber and
                // Housecall Pro create the QuickBooks customer lazily on first
                // use; ISN is the outlier that makes you map every client up
                // front. Following the majority here costs nothing and matches
                // what an inspector coming from another product expects.
                //
                // A failure inside `upsertCustomer` is already logged and filed
                // as its own `qbo_sync_errors` row against the CONTACT, so the
                // re-read below simply finds nothing and the invoice refusal
                // proceeds — two rows describing one cause, each pointing at the
                // thing its owner can act on.
                if (!qboCustomerId) {
                    const contact = await db.select({
                        id: contacts.id, name: contacts.name, email: contacts.email,
                        phone: contacts.phone, agency: contacts.agency,
                    }).from(contacts).where(
                        and(eq(contacts.id, invoice.contactId), eq(contacts.tenantId, tenantId)),
                    ).get();
                    if (contact) {
                        await this.upsertCustomer(tenantId, contact);
                        qboCustomerId = await this.findQboCustomerId(tenantId, invoice.contactId);
                    }
                }
            }

            // The tenant's civil date, not UTC. An invoice pushed at 6pm Pacific
            // on the last day of a month is still that month locally and the
            // next one in UTC — a real one-period error on somebody's books.
            // `txnDateFor` is the single date path every outbound transaction
            // shares precisely so this site cannot grow a private fourth one.
            const txnDate = await this.txnDateFor(tenantId, new Date());
            const dueDate = invoice.dueDate ? invoice.dueDate.slice(0, 10) : txnDate;

            // Shape decisions — including what an unitemised invoice becomes —
            // live in `invoice-payload.ts`.
            const lines = toQboLines(
                billableLines(invoice.lineItems, invoice.amountCents),
                conn.defaultItemId,
            );

            // QuickBooks requires CustomerRef on an Invoice and refuses the
            // whole document without it. Saying so here — before the round trip
            // — names OUR missing data instead of reporting a validation fault
            // the operator cannot act on, and it is the same statement whether
            // the invoice has no contact or the contact has never synced.
            if (!qboCustomerId) {
                const why = invoice.contactId
                    ? `contact ${invoice.contactId} has no QuickBooks customer yet`
                    : 'invoice has no contact';
                await db.update(invoices).set({ qboSyncStatus: 'failed' }).where(
                    and(eq(invoices.id, invoice.id), eq(invoices.tenantId, tenantId)),
                );
                await this.logSyncError(
                    tenantId, 'invoice', invoice.id,
                    new Error(`Cannot send to QuickBooks: ${why}`),
                );
                logger.warn('QBO upsertInvoice skipped: no customer', { tenantId, invoiceId: invoice.id, why });
                return;
            }

            const payload = buildInvoicePayload({
                docNumber: this.buildDocNumber(invoice.invoiceNumber ?? invoice.id),
                txnDate, dueDate, lines, qboCustomerId,
                status: invoice.status,
            });

            const existing = await db.select().from(qboEntityMap).where(
                and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoice.id)),
            ).get();

            try {
                if (existing) {
                    let syncToken = existing.qboSyncToken;
                    let updated: { Invoice: { Id: string; SyncToken: string } } | null = null;
                    // The LAST thing QuickBooks said, kept so the failure below
                    // can repeat it. Without this the loop reports its own
                    // guess — "after 3 stale-token retries" — for every 400,
                    // including the ones that were nothing of the kind: an
                    // invalid CustomerRef refetches cleanly and fails
                    // identically three times, and the row then blamed a token
                    // that was never the problem. A wrong diagnosis is worse
                    // than none; it sends the reader somewhere else.
                    let lastQboError: unknown = null;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            updated = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                                tenantId, 'POST', 'invoice',
                                { ...payload, Id: existing.qboId, SyncToken: syncToken },
                            );
                            break;
                        } catch (err: unknown) {
                            // 400 typically indicates a stale SyncToken — refetch and retry
                            const qboErr = err as { status?: number };
                            if (qboErr?.status === 400) {
                                lastQboError = err;
                                const refetched = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                                    tenantId, 'GET', `invoice/${existing.qboId}`,
                                );
                                syncToken = refetched.Invoice.SyncToken;
                                continue;
                            }
                            throw err;
                        }
                    }
                    // Falling out of the loop with nothing pushed is a FAILURE.
                    // It used to drop through to the 'synced' write below, so an
                    // invoice QuickBooks never received read as healthy: no error
                    // row, and the map still holding the token that was refused.
                    if (!updated) {
                        throw new Error(
                            `QBO invoice update failed after 3 attempts — ${describeQboError(lastQboError)}`,
                        );
                    }

                    await db.update(qboEntityMap).set({
                        qboSyncToken: updated.Invoice.SyncToken,
                        syncedAt:     new Date(),
                    }).where(eq(qboEntityMap.id, existing.id));
                    // No `return` here: the success path continues to the shared
                    // status write below. Returning from inside the branch is
                    // what left a once-failed invoice reading 'failed' forever.
                } else {
                    const created = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                        tenantId, 'POST', 'invoice', payload,
                    );
                    const now = new Date();
                    await db.insert(qboEntityMap).values({
                        id: crypto.randomUUID(), tenantId,
                        oiType: 'invoice', oiId: invoice.id,
                        qboType: 'Invoice', qboId: created.Invoice.Id,
                        qboSyncToken: created.Invoice.SyncToken, syncedAt: now,
                    });
                }

                await db.update(invoices).set({ qboSyncStatus: 'synced' }).where(
                    and(eq(invoices.id, invoice.id), eq(invoices.tenantId, tenantId)),
                );
            } catch (e) {
                await db.update(invoices).set({ qboSyncStatus: 'failed' }).where(
                    and(eq(invoices.id, invoice.id), eq(invoices.tenantId, tenantId)),
                );
                logger.error('QBO upsertInvoice failed', { tenantId, invoiceId: invoice.id, qbo: describeQboError(e) }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'invoice', invoice.id, e);
            }
        }

        async voidInvoice(tenantId: string, invoiceId: string): Promise<void> {
            const db = this.getDrizzle();
            const mapped = await db.select().from(qboEntityMap).where(
                and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoiceId)),
            ).get();
            if (!mapped) return;

            try {
                const voided = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                    tenantId, 'POST', `invoice?operation=void`,
                    { Id: mapped.qboId, SyncToken: mapped.qboSyncToken },
                );
                await db.update(qboEntityMap).set({
                    qboSyncToken: voided.Invoice.SyncToken,
                    syncedAt:     new Date(),
                }).where(eq(qboEntityMap.id, mapped.id));
            } catch (e) {
                logger.error('QBO voidInvoice failed', { tenantId, invoiceId, qbo: describeQboError(e) }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'invoice', invoiceId, e);
            }
        }

        /**
         * QuickBooks is the tenant's book of record, so a duplicate Payment
         * overstates their revenue and their tax position. `idempotencyKey`
         * becomes QBO's `requestid`: Intuit's contract is that a repeated key
         * returns the ORIGINAL response instead of performing the operation
         * again, which is what stops a Stripe webhook redelivery — or the
         * manual route and the webhook both firing for one invoice — becoming a
         * second Payment.
         *
         * It must identify the FACT, not the attempt. A per-attempt uuid is
         * unique every time and therefore protects nothing. Keys are unique per
         * company forever, so derive them from a row id and never from a
         * counter.
         */

    };
}
