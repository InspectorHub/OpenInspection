import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, sql } from 'drizzle-orm';
import { invoices } from '../lib/db/schema/invoice';
import { tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';
import { AutomationService } from './automation.service';
import { logger } from '../lib/logger';
import type { PaymentMethod } from '../lib/payment-method';
import type { AppendedPayment } from './payment-ledger.service';
import { syncInspectionPaymentGate } from './invoice-payment-gate';
import * as ledger from './invoice-payments.service';
import type { OfflinePaymentInput, PaymentCorrectionInput } from './invoice-payments.service';
import * as refunds from './invoice/refund';
import { applyHeldDepositsToInvoice } from './invoice/deposit-application';
import type { PartialRefundInput } from './invoice/refund';

function getStatus(inv: { sentAt: Date | null; paidAt: Date | null; partialPaidAt?: Date | null; voidedAt?: Date | null }): 'draft' | 'sent' | 'paid' | 'partial' | 'void' {
    if (inv.voidedAt) return 'void';
    if (inv.paidAt) return 'paid';
    if (inv.partialPaidAt) return 'partial';
    if (inv.sentAt) return 'sent';
    return 'draft';
}

export class InvoiceService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    /**
     * Phase B — number of invoices a tenant has (any status, void included). Used
     * by the currency-change guard: switching the tenant currency once invoices
     * exist is a data-integrity hazard, so the Workspace save requires an explicit
     * confirm when this is > 0.
     */
    async countInvoices(tenantId: string): Promise<number> {
        const db = this.getDrizzle();
        const row = await db.select({ n: sql<number>`count(*)` })
            .from(invoices).where(eq(invoices.tenantId, tenantId)).get();
        return row?.n ?? 0;
    }

    async listInvoices(tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(desc(invoices.createdAt)).all();
        return rows.map(r => ({
            ...r,
            status: getStatus(r),
            createdAt: safeISODate(r.createdAt),
            sentAt: r.sentAt ? safeISODate(r.sentAt) : null,
            paidAt: r.paidAt ? safeISODate(r.paidAt) : null,
        }));
    }

    /**
     * One invoice by id, tenant-scoped. Exists because both QuickBooks push
     * sites need the amount and nothing else: the manual route was reading it
     * out of a full `listInvoices` scan, and the Stripe webhook — which runs on
     * every card settlement — must not do that.
     *
     * Returns `null` rather than throwing: a caller that cannot find the
     * invoice has nothing to push, which is not an error.
     */
    async findById(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const row = await db.select().from(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
            .get();
        return row ?? null;
    }

    /**
     * iter-2 production bug #10 — given an inspection id, return its most
     * recent invoice (if any) within the given tenant. Used by the public
     * `/invoice/:id` payment page that the report-gate "Pay invoice" CTA
     * now points at, so an unauthenticated customer can see what they owe
     * and how to pay without being redirected to /login.
     *
     * Returns `null` when no invoice exists. Tenant-scoped — never crosses
     * workspaces.
     */
    async findByInspectionId(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        const row = await db.select().from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId)))
            .orderBy(desc(invoices.createdAt))
            .limit(1)
            .get();
        if (!row) return null;
        return {
            ...row,
            status: getStatus(row),
            createdAt: safeISODate(row.createdAt),
            sentAt: row.sentAt ? safeISODate(row.sentAt) : null,
            paidAt: row.paidAt ? safeISODate(row.paidAt) : null,
        };
    }

    async createInvoice(tenantId: string, data: {
        inspectionId?: string | null | undefined;
        clientName: string;
        clientEmail?: string | null | undefined;
        amountCents: number;
        lineItems: Array<{ description: string; amountCents: number }>;
        dueDate?: string | null | undefined;
        notes?: string | null | undefined;
    }) {
        const db = this.getDrizzle();
        // Phase B — snapshot the tenant's currency onto the invoice so history stays
        // self-describing across a later tenant currency change. Default USD.
        const cfg = await db.select({ currency: tenantConfigs.currency })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const row = {
            id: crypto.randomUUID(),
            tenantId,
            createdAt: new Date(),
            sentAt: null,
            paidAt: null,
            inspectionId: data.inspectionId ?? null,
            clientName: data.clientName,
            clientEmail: data.clientEmail ?? null,
            amountCents: data.amountCents,
            lineItems: data.lineItems,
            dueDate: data.dueDate ?? null,
            notes: data.notes ?? null,
            currency: cfg?.currency ?? 'USD',
        };
        await db.insert(invoices).values(row);
        // A deposit taken at booking has been sitting against the ORDER with no
        // invoice to belong to. This is where it becomes money against this
        // invoice — and where the client stops being shown the full total with
        // no sign their deposit landed. Awaited, not fired: `amountPaidCents`
        // below has to reflect it, and a client who pays twice calls.
        let amountPaidCents = 0;
        let partialPaidAt: Date | null = null;
        if (data.inspectionId) {
            const applied = await applyHeldDepositsToInvoice(db, tenantId, row.id, data.inspectionId);
            if (applied > 0) {
                const fresh = await db.select({
                    amountPaidCents: invoices.amountPaidCents,
                    partialPaidAt: invoices.partialPaidAt,
                })
                    .from(invoices)
                    .where(and(eq(invoices.id, row.id), eq(invoices.tenantId, tenantId)))
                    .get();
                amountPaidCents = fresh?.amountPaidCents ?? 0;
                partialPaidAt = fresh?.partialPaidAt ?? null;
            }
            new AutomationService(this.db)
                .trigger({ tenantId, inspectionId: data.inspectionId, triggerEvent: 'invoice.created', companyName: '', reportBaseUrl: '' })
                .catch(err => logger.error('automation trigger failed', { event: 'invoice.created' }, err instanceof Error ? err : undefined));
        }
        // `status` stays 'draft': a deposit does not send an invoice. The two
        // payment figures are returned because the hand-built `row` above does
        // not carry them — they are written by `recomputeInvoicePaymentState`,
        // and a caller reading `undefined` here would report a deposit-bearing
        // invoice as having received nothing.
        return {
            ...row, status: 'draft' as const, createdAt: safeISODate(row.createdAt), sentAt: null, paidAt: null,
            amountPaidCents, partialPaidAt,
        };
    }

    async markSent(id: string, tenantId: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');
        await db.update(invoices).set({ sentAt: new Date() }).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    }

    /*
     * The payment-ledger surface. Bodies live in `./invoice-payments.service`
     * — this class owns the invoice ROW, that module owns every read and write
     * of `order_payments`. Kept as methods because `c.var.services.invoice` and
     * the QBO reconciler's bound callbacks are the established call shape.
     */

    /** @see ledger.markPaid — returns the ledger row appended, or null. */
    async markPaid(id: string, tenantId: string, source: 'oi' | 'qbo' = 'oi', method?: PaymentMethod): Promise<AppendedPayment | null> {
        return ledger.markPaid(this.getDrizzle(), id, tenantId, source, method);
    }

    /** @see ledger.recordOfflinePayment — money that moved outside the system. */
    async recordOfflinePayment(tenantId: string, id: string, input: OfflinePaymentInput): Promise<AppendedPayment> {
        return ledger.recordOfflinePayment(this.getDrizzle(), tenantId, id, input);
    }

    /** @see ledger.correctPayment — appends a reversing row; never edits. */
    async correctPayment(tenantId: string, id: string, paymentId: string, input: PaymentCorrectionInput) {
        return ledger.correctPayment(this.getDrizzle(), tenantId, id, paymentId, input);
    }

    /** @see ledger.listPayments — oldest movement first. */
    async listPayments(tenantId: string, id: string) {
        return ledger.listPayments(this.getDrizzle(), tenantId, id);
    }

    /** @see ledger.markPartial — `amountPaidCents` is CUMULATIVE received. */
    async markPartial(id: string, tenantId: string, source: 'oi' | 'qbo' = 'oi', amountPaidCents: number): Promise<AppendedPayment | null> {
        return ledger.markPartial(this.getDrizzle(), id, tenantId, source, amountPaidCents);
    }

    /** @see refunds.markRefunded — reverses everything received. */
    async markRefunded(id: string, tenantId: string): Promise<void> {
        return refunds.markRefunded(this.getDrizzle(), id, tenantId);
    }

    /** @see refunds.refundPartial — returns the appended row; keys the QBO memo. */
    async refundPartial(tenantId: string, id: string, input: PartialRefundInput): Promise<AppendedPayment> {
        return refunds.refundPartial(this.getDrizzle(), tenantId, id, input);
    }

    async setQboSyncStatus(id: string, tenantId: string, status: 'synced' | 'pending' | 'failed'): Promise<void> {
        const db = this.getDrizzle();
        await db.update(invoices).set({ qboSyncStatus: status })
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    }

    /**
     * Void an invoice: set voidedAt to now and clear the payment gate if needed.
     * Idempotent — calling on an already-voided invoice is a no-op (voidedAt
     * is NOT updated again). Tenant-scoped — an invoice that belongs to another
     * tenant is silently ignored (no error, no mutation).
     */
    async voidInvoice(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        // No-op: not found (cross-tenant guard) or already voided (idempotency).
        if (!existing || existing.voidedAt) return;
        await db.update(invoices).set({ voidedAt: new Date() })
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
        await syncInspectionPaymentGate(db, tenantId, existing.inspectionId);
    }

    /**
     * "Delete" an invoice by voiding it — the row is preserved for the audit
     * trail and accounting records. Hard deletion is intentionally prohibited
     * (QuickBooks-style void lifecycle, see #182).
     */
    async deleteInvoice(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');
        await this.voidInvoice(id, tenantId);
    }

    /**
     * Returns aggregated earnings for a tenant.
     * paid: sum of paid invoice amounts (cents).
     * pending: sum of sent-but-unpaid invoice amounts.
     * count: number of paid invoices.
     */
    async getEarningsSummary(tenantId: string): Promise<{ paid: number; pending: number; count: number }> {
        const db = this.getDrizzle();
        const row = await db.select({
            paid:    sql<number>`coalesce(sum(case when ${invoices.paidAt} is not null and ${invoices.voidedAt} is null then ${invoices.amountCents} else 0 end), 0)`,
            pending: sql<number>`coalesce(sum(case when ${invoices.sentAt} is not null and ${invoices.paidAt} is null and ${invoices.voidedAt} is null then ${invoices.amountCents} else 0 end), 0)`,
            count:   sql<number>`coalesce(sum(case when ${invoices.paidAt} is not null and ${invoices.voidedAt} is null then 1 else 0 end), 0)`,
        })
        .from(invoices)
        .where(eq(invoices.tenantId, tenantId))
        .get();
        return { paid: row?.paid ?? 0, pending: row?.pending ?? 0, count: row?.count ?? 0 };
    }
}
