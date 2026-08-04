import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc, desc, sql, isNotNull, isNull } from 'drizzle-orm';
import { invoices } from '../lib/db/schema/invoice';
import { orderPayments } from '../lib/db/schema/order-payment';
import { inspections, tenantConfigs, users } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';
import { AutomationService } from './automation.service';
import { logger } from '../lib/logger';
import type { PaymentMethod } from '../lib/payment-method';
import {
    recordPayment,
    recomputeInvoicePaymentState,
    getNetReceivedCents,
    seedLedgerFromInvoiceRecord,
} from './payment-ledger.service';
import type { AppendedPayment } from './payment-ledger.service';

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
        if (data.inspectionId) {
            new AutomationService(this.db)
                .trigger({ tenantId, inspectionId: data.inspectionId, triggerEvent: 'invoice.created', companyName: '', reportBaseUrl: '' })
                .catch(err => logger.error('automation trigger failed', { event: 'invoice.created' }, err instanceof Error ? err : undefined));
        }
        return { ...row, status: 'draft' as const, createdAt: safeISODate(row.createdAt), sentAt: null, paidAt: null };
    }

    async markSent(id: string, tenantId: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');
        await db.update(invoices).set({ sentAt: new Date() }).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    }

    /**
     * Mark an invoice paid in full. Appends the outstanding remainder to the
     * payment ledger; the invoice's paid/partial/amount columns are then
     * recomputed from the ledger by its single writer, never set here.
     *
     * Returns the ledger row appended, or `null` when nothing was — an already
     * paid invoice, or one the ledger already covers. A caller pushing to an
     * external book of record must use that row's amount and id: the amount is
     * the REMAINDER collected on this occasion, which stops being the invoice
     * total the moment a deposit exists.
     */
    async markPaid(id: string, tenantId: string, source: 'oi' | 'qbo' = 'oi', method?: PaymentMethod): Promise<AppendedPayment | null> {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');
        // Idempotency: webhooks redeliver. A paid invoice stays paid with its
        // ORIGINAL timestamp — no double accounting, no date drift. Returning
        // null here is also what keeps a redelivery out of QuickBooks entirely,
        // rather than relying on their side to collapse a repeated requestid.
        if (existing.paidAt) return null;

        // Record how it was paid; keep any existing value if the caller omits one.
        const paymentMethod = method ?? existing.paymentMethod ?? null;
        if (paymentMethod !== existing.paymentMethod) {
            await db.update(invoices).set({ paymentMethod })
                .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
        }

        const outstanding = existing.amountCents - await getNetReceivedCents(db, tenantId, id);
        void source; // consumed by route handler to decide QBO sync
        if (outstanding > 0) {
            return recordPayment(db, tenantId, {
                invoiceId: id,
                inspectionId: existing.inspectionId,
                kind: 'balance',
                amountCents: outstanding,
                method: paymentMethod ?? 'offline',
            });
        }
        // Nothing left to collect (a zero-total invoice, or the ledger
        // already covers it) — the cache still has to catch up.
        await recomputeInvoicePaymentState(db, tenantId, id);
        return null;
    }

    /**
     * Record money that already moved OUTSIDE the system — cash at the door, a
     * cheque in the post. Appends exactly one ledger row; the invoice's derived
     * columns are then recomputed by the ledger's single writer, never here.
     *
     * `occurredAt` is the caller's, not `now()`. The whole reason this endpoint
     * exists rather than another `markPaid` is that the inspector records
     * Tuesday's cash on Thursday, and a reporting period keyed on the write
     * time is quietly wrong every month.
     *
     * Overpayment is refused unless the caller confirms it: it is real (a client
     * rounds up) but far more often a decimal-point typo.
     */
    async recordOfflinePayment(tenantId: string, id: string, input: {
        amountCents: number;
        method: 'check' | 'cash' | 'offline' | 'other';
        occurredAt: Date;
        note?: string | null;
        allowOverpayment?: boolean;
        recordedBy: string;
    }): Promise<AppendedPayment> {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices)
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');
        if (existing.voidedAt) throw Errors.Conflict('This invoice is void; it cannot take a payment.');

        // An invoice paid before the ledger existed has no rows at all, so the
        // outstanding figure below would read as the full total and every
        // further payment would look like an overpayment. Give it the one row
        // its own record implies first.
        await seedLedgerFromInvoiceRecord(db, tenantId, id);
        const outstanding = existing.amountCents - await getNetReceivedCents(db, tenantId, id);
        if (!input.allowOverpayment && input.amountCents > outstanding) {
            throw Errors.UnprocessableEntity(
                `This payment exceeds the outstanding balance on this invoice (${Math.max(outstanding, 0)} cents remaining). Confirm the overpayment if the amount is right.`,
            );
        }

        const appended = await recordPayment(db, tenantId, {
            invoiceId: id,
            inspectionId: existing.inspectionId,
            // A receipt against the invoice. `deposit` is reserved for money
            // taken at booking time, before any invoice exists to point at.
            kind: 'balance',
            amountCents: input.amountCents,
            method: input.method,
            // No provider and no provider_ref: this money moved outside every
            // system we integrate with, so there is nothing to reconcile against.
            provider: null,
            providerRef: null,
            recordedBy: input.recordedBy,
            note: input.note ?? null,
            occurredAt: input.occurredAt,
        });
        // `recordPayment` answers null only for a provider redelivery, and an
        // offline row carries no provider. Narrow rather than assert, so a
        // future change to that contract surfaces here instead of as a null
        // body on a 201.
        if (!appended) throw Errors.Conflict('This payment was already recorded.');
        return appended;
    }

    /**
     * Every ledger row for one invoice, oldest movement first, with the
     * recording user's name resolved.
     *
     * Ordered by `occurred_at`, not `created_at`: the list is a record of when
     * money moved, and Thursday's data entry of Tuesday's cash belongs before
     * Wednesday's cheque. `created_at` breaks ties so the order is total.
     */
    async listPayments(tenantId: string, id: string) {
        const db = this.getDrizzle();
        // Explicit column projection — a `select()` across this join runs at
        // D1's 100-column result cap for no benefit.
        const rows = await db.select({
            id: orderPayments.id,
            kind: orderPayments.kind,
            amountCents: orderPayments.amountCents,
            method: orderPayments.method,
            provider: orderPayments.provider,
            note: orderPayments.note,
            occurredAt: orderPayments.occurredAt,
            recordedBy: orderPayments.recordedBy,
            recordedByName: users.name,
            refundsId: orderPayments.refundsId,
        })
            .from(orderPayments)
            .leftJoin(users, eq(users.id, orderPayments.recordedBy))
            .where(and(eq(orderPayments.tenantId, tenantId), eq(orderPayments.invoiceId, id)))
            .orderBy(asc(orderPayments.occurredAt), asc(orderPayments.createdAt))
            .all();
        return rows.map(r => ({ ...r, occurredAt: safeISODate(r.occurredAt) }));
    }

    /**
     * Record that an invoice is partially paid. `amountPaidCents` is the
     * CUMULATIVE amount RECEIVED, in integer cents; remaining is derived by the
     * caller as `amountCents - amountPaidCents` because the invoice total is
     * the money authority, not any external system's view of it.
     *
     * The amount is REQUIRED. It used to be optional, meaning "partial, amount
     * unknown", which cleared any figure already captured. With a ledger there
     * is no such state: every partial payment is one or more rows, and the sum
     * of rows is always a known number. Making the parameter required is what
     * makes that branch unreachable rather than merely unused — it cannot be
     * called without one.
     *
     * The ledger row appended is the DELTA between the reported cumulative
     * figure and what the ledger already holds, so a repeated sync of the same
     * figure appends nothing and a figure that went DOWN records a refund.
     *
     * Returns the appended row (or `null` when the figure had not moved) on the
     * same contract as `markPaid`.
     */
    async markPartial(id: string, tenantId: string, source: 'oi' | 'qbo' = 'oi', amountPaidCents: number): Promise<AppendedPayment | null> {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');

        const delta = amountPaidCents - await getNetReceivedCents(db, tenantId, id);
        if (delta === 0) {
            await recomputeInvoicePaymentState(db, tenantId, id);
            return null;
        }
        return recordPayment(db, tenantId, {
            invoiceId: id,
            inspectionId: existing.inspectionId,
            kind: delta > 0 ? 'balance' : 'refund',
            amountCents: Math.abs(delta),
            method: existing.paymentMethod ?? 'other',
            provider: source === 'qbo' ? 'qbo' : null,
        });
    }

    /**
     * Refund an invoice: appends a `refund` row reversing everything received,
     * rather than nulling the columns. A fully refunded invoice therefore reads
     * as "45000 received, 45000 refunded, 0 outstanding received" instead of a
     * blank slate — more truthful, and the only version a reconciliation can
     * check. An invoice paid before the ledger existed is seeded from its own
     * record first, so there is something to reverse.
     */
    async markRefunded(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Invoice not found');

        await seedLedgerFromInvoiceRecord(db, tenantId, id);
        const received = await getNetReceivedCents(db, tenantId, id);
        if (received > 0) {
            await recordPayment(db, tenantId, {
                invoiceId: id,
                inspectionId: existing.inspectionId,
                kind: 'refund',
                amountCents: received,
                method: existing.paymentMethod ?? 'other',
            });
        } else {
            await recomputeInvoicePaymentState(db, tenantId, id);
        }
        await this.syncInspectionPaymentGate(existing.inspectionId, tenantId);
    }

    /**
     * After an invoice loses its paid status (refund/delete), clear a now-stale
     * `inspections.payment_status = 'paid'` report gate when NO paid invoice
     * remains for that inspection. Without this the report stays publicly
     * unlocked with no backing payment. Only downgrades a 'paid' gate; partial/
     * unpaid and inspections with another paid invoice are left untouched.
     */
    private async syncInspectionPaymentGate(inspectionId: string | null, tenantId: string): Promise<void> {
        if (!inspectionId) return;
        const db = this.getDrizzle();
        const stillPaid = await db.select({ id: invoices.id }).from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId), isNotNull(invoices.paidAt), isNull(invoices.voidedAt)))
            .limit(1).get();
        if (stillPaid) return;
        await db.update(inspections).set({ paymentStatus: 'unpaid' })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId), eq(inspections.paymentStatus, 'paid')));
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
        await this.syncInspectionPaymentGate(existing.inspectionId, tenantId);
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
