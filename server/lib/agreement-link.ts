import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { inspections, invoices } from './db/schema';

/**
 * Track I-a Task 8 — decides whether an agreement-request email should point at
 * the combined Sign & pay checkout page (`/checkout/...`) rather than the
 * standalone sign page (`/agreements/sign/...`).
 *
 * The combined link is used only when BOTH are true for the bound inspection:
 *   - the inspection requires payment (`payment_required = 1`), and
 *   - there is an outstanding (unpaid) invoice for it (`paid_at IS NULL`).
 *
 * No inspection bound, or payment already settled → standalone sign link.
 * Tolerant: any DB error resolves to `false` (safe default = sign-only link).
 */
export async function shouldUseCheckoutLink(
    DB: D1Database,
    tenantId: string,
    inspectionId: string | null | undefined,
): Promise<boolean> {
    if (!inspectionId) return false;
    try {
        const db = drizzle(DB);
        const insp = await db
            .select({ paymentRequired: inspections.paymentRequired })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp?.paymentRequired) return false;

        const unpaid = await db
            .select({ id: invoices.id })
            .from(invoices)
            .where(and(
                eq(invoices.tenantId, tenantId),
                eq(invoices.inspectionId, inspectionId),
                isNull(invoices.paidAt),
            ))
            .orderBy(desc(invoices.createdAt))
            .limit(1)
            .get();
        return !!unpaid;
    } catch {
        return false;
    }
}
