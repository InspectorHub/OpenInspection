import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap } from '../../lib/db/schema/qbo';
import { invoices } from '../../lib/db/schema/invoice';
import { tenantConfigs } from '../../lib/db/schema/tenant';
import { epochMsToWallClockYmd, resolveTenantTimeZone } from '../../lib/tz';
import { qboRefundKey } from '../../lib/qbo-payment-key';
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

export function withInvoiceSync<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        public buildDocNumber(invoiceNumber: string): string {
            return invoiceNumber.slice(0, 21);
        }

        /**
         * The accounting date for a transaction, from the instant the money
         * moved.
         *
         * `TxnDate` is a calendar date with no timezone: QuickBooks books it
         * into an accounting period as-is. It must be the day the money MOVED
         * (the ledger row's `occurred_at` — the ledger separates it from
         * `created_at` because Tuesday's cash gets recorded Thursday), in the
         * TENANT's zone: money taken at 6pm Pacific is the same civil day
         * locally and the next day in UTC, a real one-day period error at month
         * end.
         *
         * Shared by every outbound transaction so a second push site cannot
         * quietly grow a fourth date path. `new Date()` is not an acceptable
         * fallback here: it is exactly the bug this replaced.
         */
        public async txnDateFor(tenantId: string, occurredAt: Date): Promise<string> {
            const db = this.getDrizzle();
            const cfg = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
                .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
            return epochMsToWallClockYmd(
                occurredAt.getTime(), resolveTenantTimeZone(cfg?.defaultTimezone),
            );
        }

        /** Invoice → contact → mapped QBO Customer id (same join the old raw SQL did). */
        public async getQBOCustomerIdForInvoice(tenantId: string, invoiceId: string): Promise<string | null> {
            const db = this.getDrizzle();
            const row = await db
                .select({ qboCustomerId: qboEntityMap.qboId })
                .from(invoices)
                .innerJoin(
                    qboEntityMap,
                    and(
                        eq(qboEntityMap.oiId, invoices.contactId),
                        eq(qboEntityMap.tenantId, invoices.tenantId),
                        eq(qboEntityMap.oiType, 'contact'),
                    ),
                )
                .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
                .limit(1)
                .get();
            return row?.qboCustomerId ?? null;
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
                const contactMap = await db.select().from(qboEntityMap).where(
                    and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'contact'), eq(qboEntityMap.oiId, invoice.contactId)),
                ).get();
                qboCustomerId = contactMap?.qboId ?? null;
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
        async recordPayment(
            tenantId: string, invoiceId: string, amountPaid: number, idempotencyKey: string,
            occurredAt: Date,
        ): Promise<void> {
            const db = this.getDrizzle();
            const invoiceMap = await db.select().from(qboEntityMap).where(
                and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoiceId)),
            ).get();
            if (!invoiceMap) return;

            const qboCustomerId = await this.getQBOCustomerIdForInvoice(tenantId, invoiceId);
            if (!qboCustomerId) {
                logger.info('QBO recordPayment: no customer mapping — skipping', { tenantId, invoiceId });
                return;
            }

            const txnDate = await this.txnDateFor(tenantId, occurredAt);

            try {
                await this.apiCall(tenantId, 'POST', `payment?requestid=${encodeURIComponent(idempotencyKey)}`, {
                    CustomerRef: { value: qboCustomerId },
                    TotalAmt:    amountPaid,
                    TxnDate:     txnDate,
                    Line:        [{ Amount: amountPaid, LinkedTxn: [{ TxnId: invoiceMap.qboId, TxnType: 'Invoice' }] }],
                });
            } catch (e) {
                logger.error('QBO recordPayment failed', { tenantId, invoiceId, qbo: describeQboError(e) }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'invoice', invoiceId, e);
            }
        }

        /**
         * Money going back out, as a QuickBooks CreditMemo.
         *
         * `refundAmount` is in DOLLARS, like `recordPayment`'s `amountPaid` —
         * it goes straight onto `Line[0].Amount`. Callers hold cents and divide.
         * Handing this cents would post a hundred times the refund to a
         * customer's books.
         *
         * `refundRowId` is the `refund`-kind payment-ledger row. It is the unit
         * of BOTH the idempotency key and the `qbo_entity_map` identity, and it
         * is taken rather than a pre-built key precisely so those two cannot
         * disagree: the map is uniquely indexed on (tenant, oi_type, oi_id), so
         * storing the memo under the INVOICE would allow one credit memo per
         * invoice forever and make a second refund throw after the memo already
         * existed in QuickBooks. (`recordPayment` takes a ready-made key instead
         * because it writes no map row and so has nothing to keep in sync.)
         *
         * A held deposit is deliberately NOT refundable through here — it has no
         * invoice, so it has no QBO Invoice and no Payment either, and a credit
         * memo would credit a customer for revenue QuickBooks never recorded.
         * That gap is disclosed as a count in the Books health card rather than
         * papered over; see `QBOConnectionStatus.heldDepositCount`.
         */
        async createCreditMemo(
            tenantId: string, invoiceId: string, refundAmount: number,
            refundRowId: string, occurredAt: Date,
        ): Promise<void> {
            const db = this.getDrizzle();
            const conn = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
            if (!conn) return;

            const qboCustomerId = await this.getQBOCustomerIdForInvoice(tenantId, invoiceId);
            if (!qboCustomerId) {
                logger.info('QBO createCreditMemo: no customer mapping — skipping', { tenantId, invoiceId });
                return;
            }

            const txnDate = await this.txnDateFor(tenantId, occurredAt);

            try {
                const created = await this.apiCall<{ CreditMemo: { Id: string; SyncToken: string } }>(
                    tenantId, 'POST', `creditmemo?requestid=${encodeURIComponent(qboRefundKey(refundRowId))}`, {
                        CustomerRef: { value: qboCustomerId },
                        TxnDate:     txnDate,
                        Line:        [{
                            DetailType: 'SalesItemLineDetail',
                            Amount:     refundAmount,
                            SalesItemLineDetail: {
                                ItemRef:   { value: conn.defaultItemId },
                                UnitPrice: refundAmount,
                                Qty:       1,
                            },
                        }],
                    },
                );
                const now = new Date();
                // `onConflictDoNothing` because the only way to arrive here twice
                // for one row is a re-push of the same refund, and `requestid`
                // means QuickBooks answered that with the ORIGINAL memo rather
                // than a second one. Recording the same fact again is not an
                // error, and raising one would put a false failure in front of a
                // tenant whose books are correct.
                await db.insert(qboEntityMap).values({
                    id:           crypto.randomUUID(),
                    tenantId,
                    oiType:       'refund',
                    oiId:         refundRowId,
                    qboType:      'CreditMemo',
                    qboId:        created.CreditMemo.Id,
                    qboSyncToken: created.CreditMemo.SyncToken,
                    syncedAt:     now,
                }).onConflictDoNothing();
            } catch (e) {
                logger.error(
                    'QBO createCreditMemo failed',
                    { tenantId, invoiceId, refundRowId },
                    e instanceof Error ? e : undefined,
                );
                // Scoped to the ROW, not the invoice, for the same reason the
                // map row is: two refunds on one invoice that both fail are two
                // things to fix, and an invoice-keyed flag would show one.
                await this.logSyncError(tenantId, 'refund', refundRowId, e);
            }
        }
    };
}
