import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import { services, inspectionServices, discountCodes, inspections, eventTypes, reports } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { getServiceInspectors, setServiceInspectors } from './service/qualification';
import { syncSplitsQuietly } from './pay-split.service';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import type { CreateServiceSchema, UpdateServiceSchema, CreateDiscountCodeSchema } from '../lib/validations/service.schema';

type CreateServiceData  = z.infer<typeof CreateServiceSchema>;
type UpdateServiceData  = z.infer<typeof UpdateServiceSchema>;
type CreateDiscountData = z.infer<typeof CreateDiscountCodeSchema>;

export class ServiceService {
    constructor(private db: D1Database) {}

    private getDrizzle() { return drizzle(this.db); }

    async listServices(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(services)
            .where(and(eq(services.tenantId, tenantId), eq(services.active, true)))
            .orderBy(asc(services.sortOrder), asc(services.name));
    }

    /**
     * The visits a service implies, resolved from its stored event-type slugs
     * and returned in the order the fixture declares them — for radon that is
     * drop-off before pickup, which is the whole point.
     *
     * A slug with no matching event type is SKIPPED rather than erroring. That
     * is the deliberate consequence of storing slugs instead of a hard
     * reference: a tenant who tidies up their event types gets a shorter
     * proposal, not a 500 on the order screen. Returning [] for a service with
     * no defaults is the same rule with an empty list.
     */
    async proposeEventsForService(tenantId: string, serviceId: string) {
        const db = this.getDrizzle();
        const svc = await db.select({ slugs: services.defaultEventTypeSlugs }).from(services)
            .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
            .get();
        const slugs = svc?.slugs ?? [];
        if (slugs.length === 0) return [];

        const rows = await db.select().from(eventTypes)
            .where(and(eq(eventTypes.tenantId, tenantId), inArray(eventTypes.slug, slugs)))
            .all();
        const bySlug = new Map(rows.map(r => [r.slug as string, r]));
        // Order comes from the service's own list, not from the query — a
        // pickup proposed before its drop-off is a nonsense visit sequence.
        return slugs.map(s => bySlug.get(s)).filter((r): r is NonNullable<typeof r> => r != null);
    }

    async createService(tenantId: string, data: CreateServiceData) {
        const db = this.getDrizzle();
        const id = nanoid();
        const now = new Date();
        await db.insert(services).values({
            id,
            tenantId,
            name:            data.name,
            description:     data.description ?? null,
            price:           data.price,
            durationMinutes: data.durationMinutes ?? null,
            templateId:      data.templateId ?? null,
            agreementId:     data.agreementId ?? null,
            active:          true,
            sortOrder:       data.sortOrder ?? 0,
            createdAt:       now,
        });
        const rows = await db.select().from(services).where(eq(services.id, id));
        return rows[0];
    }

    async updateService(tenantId: string, id: string, data: UpdateServiceData) {
        const db = this.getDrizzle();
        const existing = await db.select().from(services)
            .where(and(eq(services.id, id), eq(services.tenantId, tenantId))).limit(1);
        if (!existing[0]) throw Errors.NotFound('Service not found');

        const update = Object.fromEntries(
            Object.entries(data).filter(([_, v]) => v !== undefined)
        );

        await db.update(services).set(update).where(and(eq(services.id, id), eq(services.tenantId, tenantId)));
        const rows = await db.select().from(services).where(eq(services.id, id));
        return rows[0];
    }

    async deleteService(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(services)
            .where(and(eq(services.id, id), eq(services.tenantId, tenantId))).limit(1);
        if (!existing[0]) throw Errors.NotFound('Service not found');
        await db.update(services).set({ active: false }).where(and(eq(services.id, id), eq(services.tenantId, tenantId)));
    }

    /**
     * The live lines on an inspection. Excludes soft-deleted ones: a line the
     * client declined at the door is history, not something still billed.
     */
    async getInspectionServices(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        return db.select().from(inspectionServices)
            .where(and(
                eq(inspectionServices.inspectionId, inspectionId),
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.active, true),
            ));
    }

    /* -------------------------------------------------------------- */
    /*  Service lines on an inspection (IA-87)                         */
    /* -------------------------------------------------------------- */

    /**
     * IA-87 — add a catalog service to an existing inspection.
     *
     * Name and price are SNAPSHOTTED at add time, the same way the create
     * paths do it: repricing the catalog tomorrow must not silently change
     * what an inspection already booked. `priceOverrideCents` charges this one
     * inspection something else without touching the catalog.
     *
     * Both the service and the inspection are re-resolved inside the caller's
     * tenant first, so a cross-tenant id pairing can never produce a row.
     * Adding a service the inspection already carries is a no-op that returns
     * the existing line — a double-submitted "Add service" must not bill twice.
     *
     * Deliberately does NOT write back to `inspections.price`: the sum of the
     * lines is authoritative over that column, which is a denormalized cache
     * only (see the money authority chain in the schema rules).
     */
    async addInspectionService(
        tenantId: string,
        inspectionId: string,
        serviceId: string,
        priceOverrideCents?: number | null,
    ) {
        const db = this.getDrizzle();

        const inspection = await db.select({ id: inspections.id }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const svc = await db.select().from(services)
            .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
            .limit(1).get();
        if (!svc) throw Errors.NotFound('Service not found');

        const existing = await db.select().from(inspectionServices)
            .where(and(
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.inspectionId, inspectionId),
                eq(inspectionServices.serviceId, serviceId),
            ))
            .limit(1).get();
        if (existing?.active) return existing;
        if (existing) {
            // Declined at the door, then wanted after all. REACTIVATE the row
            // rather than inserting a second one: a `reports` row or a pay split
            // may already point at this id, and a fresh row would strand them
            // while the client is billed for the line they can see.
            await db.update(inspectionServices).set({ active: true })
                .where(and(
                    eq(inspectionServices.id, existing.id),
                    eq(inspectionServices.tenantId, tenantId),
                ));
            await syncSplitsQuietly(db, tenantId, inspectionId);
            return { ...existing, active: true };
        }

        const id = nanoid();
        await db.insert(inspectionServices).values({
            id,
            tenantId,
            inspectionId,
            serviceId,
            priceOverride: priceOverrideCents ?? null,
            nameSnapshot: svc.name,
            priceSnapshot: svc.price,
        });
        // A new billing line is a new thing to be paid for (#278). Additive and
        // quiet: no existing amount moves, and a bad pay rule must not make
        // adding the line fail.
        await syncSplitsQuietly(db, tenantId, inspectionId);
        const rows = await db.select().from(inspectionServices)
            .where(and(eq(inspectionServices.id, id), eq(inspectionServices.tenantId, tenantId)));
        return rows[0];
    }

    /**
     * IA-87 — reprice one line on one inspection. `priceOverrideCents: null`
     * clears the override so the line falls back to its catalog snapshot.
     */
    async setInspectionServicePrice(
        tenantId: string,
        inspectionId: string,
        lineId: string,
        priceOverrideCents: number | null,
    ) {
        const db = this.getDrizzle();
        const updated = await db.update(inspectionServices)
            .set({ priceOverride: priceOverrideCents })
            .where(and(
                eq(inspectionServices.id, lineId),
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.inspectionId, inspectionId),
            ))
            .returning();
        if (updated.length === 0) throw Errors.NotFound('Service line not found');
        return updated[0];
    }

    /**
     * IA-87 — drop a service line from an inspection.
     *
     * Soft delete, so the history of what was sold survives a scope change at
     * the door — and so a `reports` row or a pay split that points at this line
     * still finds it.
     *
     * The REFUSAL half of the guard: removal is allowed while a line is bare,
     * and refused once something hangs off it that a soft delete would strand.
     * Nothing here carries an FK (by design), so nothing else surfaces the
     * dangle — this check is the only thing standing between a scope change at
     * the door and a report delivering a line that is no longer on the invoice.
     *
     * Today that is a `reports` row (in_progress or published — both block:
     * both are work the line paid for). The pay-split clause stays deferred to
     * the pay-splits plan as its own explicit step — `inspection_service_pay_
     * splits` still does not exist, and a check against a table that does not
     * exist is a gate that passes vacuously.
     */
    async removeInspectionService(tenantId: string, inspectionId: string, lineId: string) {
        const db = this.getDrizzle();
        const line = await db.select({ id: inspectionServices.id, active: inspectionServices.active })
            .from(inspectionServices)
            .where(and(
                eq(inspectionServices.id, lineId),
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.inspectionId, inspectionId),
            ))
            .get();
        if (!line || !line.active) throw Errors.NotFound('Service line not found');

        const blockingReport = await db.select({ id: reports.id, status: reports.status })
            .from(reports)
            .where(and(
                eq(reports.tenantId, tenantId),
                eq(reports.inspectionServiceId, lineId),
            ))
            .limit(1).get();
        if (blockingReport) {
            // The refusal names what blocked it — the UI disables the control
            // with this reason rather than a silent no-op.
            throw Errors.Conflict(
                `Cannot remove this service line: a report (${blockingReport.status}) delivers it. Delete the report first.`,
            );
        }

        await db.update(inspectionServices).set({ active: false })
            .where(and(
                eq(inspectionServices.id, lineId),
                eq(inspectionServices.tenantId, tenantId),
                eq(inspectionServices.inspectionId, inspectionId),
            ));
        // Unpaid rule-derived splits on the dropped line go with it; anything a
        // human agreed or payroll locked survives as an orphan to resolve (#278).
        await syncSplitsQuietly(db, tenantId, inspectionId);
    }

    async listDiscountCodes(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(discountCodes)
            .where(eq(discountCodes.tenantId, tenantId));
    }

    async updateDiscountCode(
        tenantId: string,
        id: string,
        data: Partial<Omit<typeof discountCodes.$inferInsert, 'expiresAt'>> & { expiresAt?: string | null },
    ) {
        const db = this.getDrizzle();
        const { expiresAt, ...rest } = data;
        const patch: Partial<typeof discountCodes.$inferInsert> = { ...rest };
        if (expiresAt !== undefined) patch.expiresAt = expiresAt ? new Date(expiresAt) : null;
        const updated = await db.update(discountCodes)
            .set(patch)
            .where(and(eq(discountCodes.id, id), eq(discountCodes.tenantId, tenantId)))
            .returning();
        if (updated.length === 0) throw Errors.NotFound('Discount code not found');
        return updated[0];
    }

    async deleteDiscountCode(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const result = await db.delete(discountCodes)
            .where(and(eq(discountCodes.id, id), eq(discountCodes.tenantId, tenantId)))
            .returning({ id: discountCodes.id });
        if (result.length === 0) throw Errors.NotFound('Discount code not found');
    }

    async createDiscountCode(tenantId: string, data: CreateDiscountData) {
        const db = this.getDrizzle();
        const id = nanoid();
        await db.insert(discountCodes).values({
            id,
            tenantId,
            code:      data.code.toUpperCase(),
            type:      data.type,
            value:     data.value,
            maxUses:   data.maxUses ?? null,
            usesCount: 0,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            active:    true,
            createdAt: new Date(),
        });
        const rows = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
        return rows[0];
    }

    // IA-26 — per-service inspector qualification. The implementation lives in
    // service/qualification.ts; these delegates keep every caller unchanged.
    async getServiceInspectors(tenantId: string, serviceId: string): Promise<string[]> {
        return getServiceInspectors(this.getDrizzle(), tenantId, serviceId);
    }

    async setServiceInspectors(tenantId: string, serviceId: string, userIds: string[]): Promise<number> {
        return setServiceInspectors(this.getDrizzle(), tenantId, serviceId, userIds);
    }

    async validateDiscountCode(tenantId: string, code: string, subtotal: number): Promise<{
        valid: boolean;
        discountAmount: number;
        discountCodeId: string | null;
        message?: string;
    }> {
        const invalid = (message: string) =>
            ({ valid: false as const, discountAmount: 0, discountCodeId: null, message });

        const db = this.getDrizzle();
        const rows = await db.select().from(discountCodes)
            .where(and(eq(discountCodes.tenantId, tenantId), eq(discountCodes.active, true)));
        // JS-side filter instead of SQL UPPER() — intentional for D1 compatibility
        const dc = rows.find(r => r.code.toUpperCase() === code.toUpperCase());

        if (!dc) return invalid('Code not found');
        if (dc.expiresAt && dc.expiresAt < new Date()) return invalid('Code expired');
        if (dc.maxUses !== null && dc.usesCount >= dc.maxUses) return invalid('Code usage limit reached');

        const discountAmount = dc.type === 'fixed'
            ? Math.min(dc.value, subtotal)
            : Math.floor(subtotal * dc.value / 100);

        return { valid: true, discountAmount, discountCodeId: dc.id };
    }

    /**
     * Atomically increments uses_count for a discount code, enforcing max_uses.
     * Returns true if the redemption was accepted (a row changed), false if the
     * cap blocked it (uses_count >= max_uses) or the code doesn't exist for
     * this tenant. Tenant-scoped: the WHERE clause filters tenant_id so a
     * cross-tenant id can never consume another tenant's quota.
     */
    async redeemDiscountCode(tenantId: string, discountCodeId: string): Promise<boolean> {
        const db = this.getDrizzle();
        const res = await db.update(discountCodes)
            .set({ usesCount: sql`${discountCodes.usesCount} + 1` })
            .where(and(
                eq(discountCodes.id, discountCodeId),
                eq(discountCodes.tenantId, tenantId),
                sql`(${discountCodes.maxUses} IS NULL OR ${discountCodes.usesCount} < ${discountCodes.maxUses})`,
            )).run();
        const r = res as unknown as { meta?: { changes?: number }; changes?: number };
        return (r.meta?.changes ?? r.changes ?? 0) > 0;
    }
}
