/**
 * The outbound transactions that hang off an invoice — a payment, a refund, a
 * credit memo — plus the three lookups every outbound push shares.
 *
 * Split out of `invoice-sync.ts` when that file passed the 400-line ceiling.
 * The seam is real rather than arbitrary: nothing here touches `upsertInvoice`
 * or `voidInvoice`, and everything here needs the same customer id and the same
 * accounting date, so the shared lookups come down with them. Composed BELOW
 * invoice sync, which inherits the three helpers.
 */
import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap } from '../../lib/db/schema/qbo';
import { invoices } from '../../lib/db/schema/invoice';
import { tenantConfigs } from '../../lib/db/schema/tenant';
import { epochMsToWallClockYmd, resolveTenantTimeZone } from '../../lib/tz';
import { qboRefundKey } from '../../lib/qbo-payment-key';
import { logger } from '../../lib/logger';
import type { Constructor, QBOServiceBase } from './api-base';
import { describeQboError } from './api-base';

export function withPaymentSync<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        /** The contact's QuickBooks twin, or null when it has none yet. */
        public async findQboCustomerId(tenantId: string, contactId: string): Promise<string | null> {
            const row = await this.getDrizzle().select().from(qboEntityMap).where(and(
                eq(qboEntityMap.tenantId, tenantId),
                eq(qboEntityMap.oiType, 'contact'),
                eq(qboEntityMap.oiId, contactId),
            )).get();
            return row?.qboId ?? null;
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
