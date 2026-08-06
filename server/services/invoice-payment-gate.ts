/**
 * The report's payment gate, re-synced after an invoice loses paid status.
 *
 * `inspections.payment_status = 'paid'` is what unlocks a report publicly, and
 * it is a CACHE of "some unvoided invoice on this inspection is paid". Every
 * writer that can falsify that sentence — refund, correction, void, delete —
 * has to call this, or the report stays unlocked with no backing payment.
 *
 * It lives in its own module, exported, precisely because that list keeps
 * growing: it was a private method on `InvoiceService`, which meant a new
 * writer either moved into that class or quietly skipped the re-sync. Skipping
 * it is invisible in every test that does not read `inspections`.
 *
 * Only DOWNGRADES a 'paid' gate. Partial, unpaid, and inspections that still
 * have another paid invoice are left exactly as they are.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { inspections } from '../lib/db/schema';
import { invoices } from '../lib/db/schema/invoice';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export async function syncInspectionPaymentGate(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string | null,
): Promise<void> {
    if (!inspectionId) return;
    const stillPaid = await db.select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId), isNotNull(invoices.paidAt), isNull(invoices.voidedAt)))
        .limit(1).get();
    if (stillPaid) return;
    await db.update(inspections).set({ paymentStatus: 'unpaid' })
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId), eq(inspections.paymentStatus, 'paid')));
}
