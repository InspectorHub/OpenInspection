import { eq, and } from 'drizzle-orm';
import { qboConnections, qboEntityMap } from '../../lib/db/schema/qbo';
import { invoices } from '../../lib/db/schema/invoice';
import { logger } from '../../lib/logger';
import type {
    Constructor,
    InvoiceSummary,
    MarkPaidFn,
    MarkPartialFn,
    QBOServiceBase,
} from './api-base';

export function withInvoiceSync<TBase extends Constructor<QBOServiceBase>>(Base: TBase) {
    return class extends Base {
        protected buildDocNumber(invoiceNumber: string): string {
            return invoiceNumber.slice(0, 21);
        }

        /** Invoice → contact → mapped QBO Customer id (same join the old raw SQL did). */
        protected async getQBOCustomerIdForInvoice(tenantId: string, invoiceId: string): Promise<string | null> {
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

        protected async applyInvoiceStatusFromQBO(
            tenantId: string,
            inv: InvoiceSummary,
            markPaid: MarkPaidFn,
            markPartial: MarkPartialFn,
        ): Promise<boolean> {
            const db = this.getDrizzle();
            const mapped = await db.select().from(qboEntityMap).where(
                and(
                    eq(qboEntityMap.tenantId, tenantId),
                    eq(qboEntityMap.qboType, 'Invoice'),
                    eq(qboEntityMap.qboId, inv.Id),
                ),
            ).get();
            if (!mapped) return false;

            await db.update(qboEntityMap).set({
                qboSyncToken: inv.SyncToken,
                syncedAt:     new Date(),
            }).where(eq(qboEntityMap.id, mapped.id));

            if (inv.Balance === 0) {
                await markPaid(mapped.oiId, tenantId);
            } else if (inv.Balance < inv.TotalAmt) {
                // QuickBooks amounts are dollars (see the reverse mapping in
                // upsertInvoice, `Amount: amountCents / 100`). Round each side to
                // its own exact cent value before subtracting: a bare float
                // multiply on the difference produces off-by-one-cent amounts
                // that are impossible to explain to a customer. This is the ONLY
                // place the conversion happens — adapters receive cents.
                const amountPaidCents = Math.round(inv.TotalAmt * 100) - Math.round(inv.Balance * 100);
                await markPartial(mapped.oiId, amountPaidCents, tenantId);
            }
            return true;
        }

        async upsertInvoice(
            tenantId: string,
            invoice: {
                id: string;
                invoiceNumber?: string | null;
                contactId?: string | null;
                dueDate?: string | null;
                lineItems: Array<{ description: string; amountCents: number; quantity?: number }>;
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

            const today = new Date().toISOString().slice(0, 10);
            const dueDate = invoice.dueDate ? invoice.dueDate.slice(0, 10) : today;

            const lines = invoice.lineItems.map(item => {
                const qty = item.quantity ?? 1;
                return {
                    DetailType: 'SalesItemLineDetail',
                    Amount:     item.amountCents / 100,
                    SalesItemLineDetail: {
                        ItemRef:   { value: conn.defaultItemId, name: item.description.slice(0, 100) },
                        UnitPrice: item.amountCents / 100 / qty,
                        Qty:       qty,
                    },
                };
            });

            const payload: Record<string, unknown> = {
                DocNumber:   this.buildDocNumber(invoice.invoiceNumber ?? invoice.id),
                TxnDate:     today,
                DueDate:     dueDate,
                Line:        lines,
                EmailStatus: invoice.status === 'sent' ? 'EmailSent' : 'NotSet',
            };
            if (qboCustomerId) payload.CustomerRef = { value: qboCustomerId };

            const existing = await db.select().from(qboEntityMap).where(
                and(eq(qboEntityMap.tenantId, tenantId), eq(qboEntityMap.oiType, 'invoice'), eq(qboEntityMap.oiId, invoice.id)),
            ).get();

            try {
                if (existing) {
                    let syncToken = existing.qboSyncToken;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const updated = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                                tenantId, 'PUT', 'invoice',
                                { ...payload, Id: existing.qboId, SyncToken: syncToken },
                            );
                            await db.update(qboEntityMap).set({
                                qboSyncToken: updated.Invoice.SyncToken,
                                syncedAt:     new Date(),
                            }).where(eq(qboEntityMap.id, existing.id));
                            return;
                        } catch (err: unknown) {
                            // 400 typically indicates a stale SyncToken — refetch and retry
                            const qboErr = err as { status?: number };
                            if (qboErr?.status === 400) {
                                const refetched = await this.apiCall<{ Invoice: { Id: string; SyncToken: string } }>(
                                    tenantId, 'GET', `invoice/${existing.qboId}`,
                                );
                                syncToken = refetched.Invoice.SyncToken;
                                continue;
                            }
                            throw err;
                        }
                    }
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
                logger.error('QBO upsertInvoice failed', { tenantId, invoiceId: invoice.id }, e instanceof Error ? e : undefined);
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
                logger.error('QBO voidInvoice failed', { tenantId, invoiceId }, e instanceof Error ? e : undefined);
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

            try {
                await this.apiCall(tenantId, 'POST', `payment?requestid=${encodeURIComponent(idempotencyKey)}`, {
                    CustomerRef: { value: qboCustomerId },
                    TotalAmt:    amountPaid,
                    TxnDate:     new Date().toISOString().slice(0, 10),
                    Line:        [{ Amount: amountPaid, LinkedTxn: [{ TxnId: invoiceMap.qboId, TxnType: 'Invoice' }] }],
                });
            } catch (e) {
                logger.error('QBO recordPayment failed', { tenantId, invoiceId }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'invoice', invoiceId, e);
            }
        }

        async createCreditMemo(tenantId: string, invoiceId: string, refundAmount: number): Promise<void> {
            const db = this.getDrizzle();
            const conn = await db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get();
            if (!conn) return;

            const qboCustomerId = await this.getQBOCustomerIdForInvoice(tenantId, invoiceId);
            if (!qboCustomerId) return;

            try {
                const created = await this.apiCall<{ CreditMemo: { Id: string; SyncToken: string } }>(
                    tenantId, 'POST', 'creditmemo', {
                        CustomerRef: { value: qboCustomerId },
                        TxnDate:     new Date().toISOString().slice(0, 10),
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
                await db.insert(qboEntityMap).values({
                    id:           crypto.randomUUID(),
                    tenantId,
                    oiType:       'refund',
                    oiId:         invoiceId,
                    qboType:      'CreditMemo',
                    qboId:        created.CreditMemo.Id,
                    qboSyncToken: created.CreditMemo.SyncToken,
                    syncedAt:     now,
                });
            } catch (e) {
                logger.error('QBO createCreditMemo failed', { tenantId, invoiceId }, e instanceof Error ? e : undefined);
                await this.logSyncError(tenantId, 'refund', invoiceId, e);
            }
        }
    };
}
