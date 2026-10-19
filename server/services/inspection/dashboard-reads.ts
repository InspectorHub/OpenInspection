import { and, eq, isNull } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { inspections, tenantConfigs, invoices, agreementRequests, inspectionServices } from '../../lib/db/schema';
import { visibleInspectionsCondition, type InspectionScope } from '../../lib/inspection/visibility';

/**
 * The dashboard's first group of reads: everything that needs only the company id.
 *
 * Each statement is a round trip to D1, so reads go out in groups by what they need. This group is
 * sent together; the reads that need the inspection set it returns (defect results, agent and
 * inspector names) go out together after it.
 *
 * Every bucket is cut from the inspection set, so scoping it scopes them all. The company-wide
 * lookups only answer "does this inspection have one": no row of them reaches the response unless
 * its inspection is in `all`.
 */
export function readDashboardInputs(db: ReturnType<typeof drizzle>, tenantId: string, scope: InspectionScope) {
    return Promise.all([
        db.select().from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), visibleInspectionsCondition(db, scope, tenantId))),
        // handoff-decisions §1 — the configurable attention thresholds (null when the row is missing).
        db.select({ thresholds: tenantConfigs.attentionThresholds })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1),
        // Track I-a — agreement-signed truth rides the envelope: a signed
        // agreement_requests row (any channel) lights the dashboard icon.
        db.select({ inspectionId: agreementRequests.inspectionId })
            .from(agreementRequests)
            .where(and(eq(agreementRequests.tenantId, tenantId), eq(agreementRequests.status, 'signed'))),
        // One read of the non-voided invoices answers which unpaid ones are overdue and what an
        // inspection's invoice amount is (IA-131). The earliest created wins the amount.
        db.select({
            inspectionId: invoices.inspectionId,
            dueDate:      invoices.dueDate,
            amountCents:  invoices.amountCents,
            createdAt:    invoices.createdAt,
            paidAt:       invoices.paidAt,
        })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), isNull(invoices.voidedAt)))
            .orderBy(invoices.createdAt),
        db.select({
            inspectionId:  inspectionServices.inspectionId,
            priceSnapshot: inspectionServices.priceSnapshot,
            priceOverride: inspectionServices.priceOverride,
        })
            .from(inspectionServices)
            // Feeds getEffectivePriceCents — a soft-deleted line is history and
            // must not be summed into what an inspection is worth.
            .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.active, true))),
    ]);
}
