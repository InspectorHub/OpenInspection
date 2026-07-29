import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contacts, inspections, inspectionPeople, invoices } from '../lib/db/schema';
import { getEffectivePriceCents } from '../lib/effective-price';
import { safeISODate } from '../lib/date';

/**
 * The contact detail payload (IA-18) — one contact, its inspection history, and
 * the money that history is worth.
 *
 * Extracted from ContactService purely for size: the service crossed the 400-line
 * gate and this was its largest single method, and a self-contained one. It takes
 * an explicit `db` rather than reaching through the service, which is also what
 * lets it be read on its own.
 *
 * The money here is deliberately NOT `inspections.price`. That column is tier 3
 * of the P-4 authority chain, a denormalized cache, and reading it directly is
 * what made this card show "TOTAL REVENUE $450.00" above the very inspection it
 * had just listed at "$0.00 / Unpaid". One invoice pass feeds both readers.
 */
export async function buildContactDetail(
    db: DrizzleD1Database,
    id: string,
    tenantId: string,
) {

        

        const contact = await db.select().from(contacts)
            .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).get();
        if (!contact) return null;

        const rows = await db.select({
            id:            inspections.id,
            propertyAddress: inspections.propertyAddress,
            date:          inspections.date,
            status:        inspections.status,
            price:         inspections.price,
            paymentStatus: inspections.paymentStatus,
        }).from(inspections)
            .innerJoin(inspectionPeople, eq(inspectionPeople.inspectionId, inspections.id))
            .where(and(
                eq(inspections.tenantId, tenantId),
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.contactId, id),
            ))
            .all();

        // Dedup by inspection id (a row matched by both linkage paths appears
        // once) and order date desc, newest first.
        const seen = new Set<string>();
        const inspectionRows = rows
            .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

        const inspectionIds = inspectionRows.map(r => r.id);

        // One pass over the invoices on these inspections, serving two readers.
        //
        // Revenue counts PAID ones only. The per-row price needs EVERY live one,
        // because an invoice is tier 1 of the P-4 authority chain whether or not
        // it has been paid — `inspections.price` is a denormalized cache and its
        // own schema comment says to read through getEffectivePriceCents().
        // Reading the cache directly is how this card came to state
        // "TOTAL REVENUE $450.00" beside that same inspection listed at "$0.00".
        //
        // Chunk the inArray to stay under D1's 100-bind-param ceiling.
        let totalRevenueCents = 0;
        const invoiceByInspection = new Map<string, number>();
        const paidInspectionIds = new Set<string>();
        const CHUNK = 90;
        for (let i = 0; i < inspectionIds.length; i += CHUNK) {
            const chunk = inspectionIds.slice(i, i + CHUNK);
            const rows = await db.select({
                inspectionId: invoices.inspectionId,
                amountCents:  invoices.amountCents,
                paidAt:       invoices.paidAt,
            })
                .from(invoices)
                .where(and(
                    eq(invoices.tenantId, tenantId),
                    inArray(invoices.inspectionId, chunk),
                    isNull(invoices.voidedAt),
                ))
                .all();
            for (const inv of rows) {
                if (!inv.inspectionId) continue;
                if (inv.paidAt) {
                    totalRevenueCents += inv.amountCents ?? 0;
                    paidInspectionIds.add(inv.inspectionId);
                }
                if (!invoiceByInspection.has(inv.inspectionId)) {
                    invoiceByInspection.set(inv.inspectionId, inv.amountCents ?? 0);
                }
            }
        }

        return {
            contact: {
                id:         contact.id,
                type:       contact.type,
                name:       contact.name,
                email:      contact.email,
                phone:      contact.phone,
                agency:     contact.agency,
                notes:      contact.notes,
                createdAt:  safeISODate(contact.createdAt),
                archivedAt: contact.archivedAt ? safeISODate(contact.archivedAt) : null,
            },
            inspections: inspectionRows.map(r => ({
                id:              r.id,
                propertyAddress: r.propertyAddress,
                date:            r.date,
                status:          r.status,
                // Service lines are deliberately not loaded here, so tier 2 is
                // skipped: the helper treats undefined as "not loaded" and falls
                // through, which is the correct behaviour rather than a gap.
                price:           getEffectivePriceCents({
                    invoiceAmountCents:   invoiceByInspection.get(r.id) ?? null,
                    inspectionPriceCents: r.price,
                }),
                // A paid invoice settles the question, and saying otherwise
                // beside a corrected amount reads worse than the old all-wrong
                // row did. Deliberately one-directional: a paid invoice can
                // promote the row, nothing here demotes it, so `partial` —
                // which only the inspection models, via markPartial — survives.
                paymentStatus:   paidInspectionIds.has(r.id) ? 'paid' as const : r.paymentStatus,
            })),
            stats: {
                inspectionCount:   inspectionRows.length,
                totalRevenueCents,
            },
        };
}
