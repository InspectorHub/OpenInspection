/**
 * The deposit, from catalogue prices to a number frozen on the order.
 *
 * ON THE MONEY BASIS, because the next reader will want to "fix" it. The
 * deposit resolves against the summed `services.price_cents` of what was
 * selected, read straight from the catalogue at booking time, and NOT against
 * tier 2 of the money-authority chain. That is not an oversight:
 *
 *   - The public booking path does not write `inspection_services` rows
 *     (`writeInspectionServiceSnapshots` exists and only the dashboard wizard
 *     calls it), so at the moment the deposit is computed there is no tier 2
 *     to read. Wiring that writer into booking is a real behaviour change — it
 *     turns tier-2 authority on for every booking-created order and moves
 *     their invoice totals off `inspections.price`/0 — and it belongs to
 *     whoever does it deliberately, with the invoice-total change in the same
 *     change. It is NOT a prerequisite for this.
 *   - Even once it is wired, the deposit would still snapshot. A percentage
 *     resolves against the price on the day; the client owes what they agreed
 *     to, not what the catalogue says next week.
 *
 * So this reads the catalogue, and `inspections.deposit_required_cents` holds
 * the answer. Nothing downstream re-derives it.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, services as servicesTable, tenantConfigs } from '../../lib/db/schema';
import { resolveOrderDeposit, type DepositLine } from '../../lib/billing/deposit-policy';
import { getHeldDepositCents } from '../payment-ledger.service';

/**
 * What this order should be asked for up front. Zero when the workspace has
 * configured nothing, which is how every workspace ships and therefore the
 * answer for almost every call — the tenant-config read is the only query that
 * always happens, and the catalogue read is skipped when there is nothing to
 * resolve.
 */
export async function resolveBookingDepositCents(
    db: DrizzleD1Database,
    tenantId: string,
    serviceIds: string[],
): Promise<number> {
    const cfg = await db.select({ depositPolicy: tenantConfigs.depositPolicy })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    const tenantPolicy = cfg?.depositPolicy ?? null;
    if (serviceIds.length === 0) return 0;

    const rows = await db.select({
        price: servicesTable.price,
        depositPolicy: servicesTable.depositPolicy,
    })
        .from(servicesTable)
        .where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, serviceIds)))
        .all();
    if (rows.length === 0) return 0;

    // A service with no policy of its own still needs the workspace default
    // applied, so the "nothing configured anywhere" shortcut is only safe once
    // we know no service overrides it.
    const lines: DepositLine[] = rows.map(r => ({
        priceCents: r.price ?? 0,
        policy: r.depositPolicy ?? null,
    }));
    if (!tenantPolicy && lines.every(l => l.policy === null)) return 0;

    return resolveOrderDeposit({ tenant: tenantPolicy, lines });
}

/**
 * Freeze the amount on the order.
 *
 * ONE deposit per booking, on the PRIMARY inspection; the siblings a
 * multi-service booking creates are explicitly set to 0 rather than left NULL.
 * NULL and 0 would read the same to arithmetic and differently to a human —
 * "no deposit configured" versus "this one is covered by the order's" — and it
 * is the second that is true.
 *
 * Never overwrites a figure an operator set: `deposit_overridden` exists for
 * exactly this, and a booking-time resolve is the re-resolve it guards against.
 * Non-fatal by construction at the call site: the inspection rows are already
 * committed and a failure here must not lose an appointment the client believes
 * they made.
 */
export async function snapshotOrderDeposit(
    db: DrizzleD1Database,
    tenantId: string,
    primaryInspectionId: string,
    allInspectionIds: string[],
    depositCents: number,
): Promise<void> {
    const siblings = allInspectionIds.filter(id => id !== primaryInspectionId);
    if (siblings.length > 0) {
        await db.update(inspections).set({ depositRequiredCents: 0 })
            .where(and(
                eq(inspections.tenantId, tenantId),
                inArray(inspections.id, siblings),
                eq(inspections.depositOverridden, false),
            ));
    }
    await db.update(inspections).set({ depositRequiredCents: depositCents })
        .where(and(
            eq(inspections.tenantId, tenantId),
            eq(inspections.id, primaryInspectionId),
            eq(inspections.depositOverridden, false),
        ));
}

/** What is still owed of an order's deposit: asked for, minus what has landed. */
export async function outstandingDepositCents(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<{ requiredCents: number; heldCents: number; outstandingCents: number } | null> {
    const row = await db.select({ requiredCents: inspections.depositRequiredCents })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!row) return null;
    const requiredCents = row.requiredCents ?? 0;
    const heldCents = await getHeldDepositCents(db, tenantId, inspectionId);
    return { requiredCents, heldCents, outstandingCents: Math.max(0, requiredCents - heldCents) };
}
