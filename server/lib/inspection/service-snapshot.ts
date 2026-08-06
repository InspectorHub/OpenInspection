import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { services, inspectionServices } from '../db/schema';

/** One service the caller asked for, with an optional per-line reprice. */
export interface ServiceSelection {
    serviceId: string;
    priceOverrideCents?: number;
}

/** The rows written, in catalog-row order. */
export type InspectionServiceRow = typeof inspectionServices.$inferInsert;

/**
 * Snapshot the selected services onto an inspection as `inspection_services`
 * rows — tier 2 of the money-authority chain that `getEffectivePriceCents()`
 * reads (`server/lib/effective-price.ts`). An inspection with no rows here has
 * no tier-2 authority at all, so its price falls through to `inspections.price`,
 * the cache the schema rules forbid treating as authority. Pay splits attach to
 * these lines too, so an order without them has nothing to split.
 *
 * Snapshots, not references: `nameSnapshot` / `priceSnapshot` freeze what the
 * catalog said on the day, so editing a service later never rewrites history.
 *
 * `serviceSelections` (IA-1 superset) takes precedence over the legacy flat
 * `serviceIds` list when both are present — the handlers already merge them so
 * only one branch ever fires.
 *
 * UNKNOWN IDS ARE SKIPPED, NOT AN ERROR. That is the dashboard wizard's
 * contract, preserved here byte for byte. It is deliberately NOT the contract
 * of `attachHoldServices` (`server/services/concierge/hold-inputs.ts`), which
 * throws on an unknown id because a hold that silently drops a service
 * under-quotes the client. Two contracts, two functions — do not merge them.
 *
 * CALLERS. `InspectionCoreService.createInspection` (the dashboard wizard) is
 * the only one today. The PUBLIC BOOKING PATH DOES NOT CALL THIS YET and so
 * still produces orders with no tier-2 authority: see
 * `[redacted]`, Decision 3.
 * The two candidate call sites are `BookingService.fulfillBooking`'s
 * direct-insert branch and `InspectionRequestService.create` (which owns the
 * multi-service branch's inspections); wiring exactly one of them — not both,
 * or a booking's lines get written twice — belongs to booking-deposit (#20),
 * together with the invoice-total change that turning tier 2 on implies.
 */
export async function writeInspectionServiceSnapshots(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    // `| undefined` explicitly: under exactOptionalPropertyTypes an absent key
    // and a present-but-undefined one are different types, and every caller
    // reads these off a wider input object where they are the latter.
    selections: { serviceSelections?: ServiceSelection[] | undefined; serviceIds?: string[] | undefined },
): Promise<InspectionServiceRow[]> {
    const { serviceSelections, serviceIds } = selections;
    const effectiveServiceIds: string[] = serviceSelections && serviceSelections.length > 0
        ? serviceSelections.map(s => s.serviceId)
        : (serviceIds ?? []);
    if (effectiveServiceIds.length === 0) return [];

    const svcRows = await db.select().from(services)
        .where(and(eq(services.tenantId, tenantId), inArray(services.id, effectiveServiceIds)));
    if (svcRows.length === 0) return [];

    // Build a map from serviceId → priceOverrideCents for fast lookup.
    const overrideMap = new Map<string, number | undefined>(
        (serviceSelections ?? []).map(s => [s.serviceId, s.priceOverrideCents]),
    );
    const rows: InspectionServiceRow[] = svcRows.map(s => ({
        id:            crypto.randomUUID(),
        tenantId,
        inspectionId,
        serviceId:     s.id,
        priceOverride: overrideMap.get(s.id) ?? null,
        nameSnapshot:  s.name,
        priceSnapshot: s.price,
    }));
    await db.insert(inspectionServices).values(rows);
    return rows;
}
