import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc, isNull, ne, inArray, sql } from 'drizzle-orm';
import { services, inspectionServices, discountCodes, serviceInspectors, users } from '../lib/db/schema';
import { Errors } from '../lib/errors';
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

    async getInspectionServices(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        return db.select().from(inspectionServices)
            .where(and(
                eq(inspectionServices.inspectionId, inspectionId),
                eq(inspectionServices.tenantId, tenantId)
            ));
    }

    async listDiscountCodes(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(discountCodes)
            .where(eq(discountCodes.tenantId, tenantId));
    }

    async updateDiscountCode(tenantId: string, id: string, data: Partial<typeof discountCodes.$inferInsert>) {
        const db = this.getDrizzle();
        const updated = await db.update(discountCodes)
            .set(data)
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
            expiresAt: data.expiresAt ?? null,
            active:    true,
            createdAt: new Date(),
        });
        const rows = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
        return rows[0];
    }

    // IA-26 — per-service inspector qualification write face

    /**
     * Returns the current list of restricted inspector userIds for a service.
     * An empty list means all staff are qualified (no rows = open).
     * Throws 404 if the service does not belong to the given tenant.
     */
    async getServiceInspectors(tenantId: string, serviceId: string): Promise<string[]> {
        const db = this.getDrizzle();
        const svc = await db.select({ id: services.id }).from(services)
            .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
            .limit(1).get();
        if (!svc) throw Errors.NotFound('Service not found');

        const rows = await db.select({ userId: serviceInspectors.userId }).from(serviceInspectors)
            .where(and(eq(serviceInspectors.serviceId, serviceId), eq(serviceInspectors.tenantId, tenantId)))
            .all();
        return rows.map(r => r.userId);
    }

    /**
     * Full-replace the inspector restriction list for a service.
     * Empty userIds = clear all rows (back to "all staff qualified").
     * Validates that every provided userId is a non-deleted, non-agent tenant member.
     * Throws 404 if the service is not found in the tenant; 400 on invalid userIds.
     */
    async setServiceInspectors(tenantId: string, serviceId: string, userIds: string[]): Promise<number> {
        const db = this.getDrizzle();

        // 404 guard
        const svc = await db.select({ id: services.id }).from(services)
            .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
            .limit(1).get();
        if (!svc) throw Errors.NotFound('Service not found');

        if (userIds.length > 0) {
            // Validate: every userId must be a non-deleted, non-agent member of the tenant.
            const validMembers = await db.select({ id: users.id }).from(users)
                .where(and(
                    eq(users.tenantId, tenantId),
                    isNull(users.deletedAt),
                    ne(users.role, 'agent'),
                    inArray(users.id, userIds),
                ))
                .all();
            const validSet = new Set(validMembers.map(m => m.id));
            const invalid = userIds.filter(id => !validSet.has(id));
            if (invalid.length > 0) {
                throw Errors.BadRequest(`Invalid or ineligible user IDs: ${invalid.join(', ')}`);
            }
        }

        // Full-replace atomically: delete existing rows then insert new ones in one
        // db.batch() so a failed insert can never leave zero rows (fail-open).
        // Drivers without batch support (e.g. the better-sqlite3 unit-test mock)
        // fall back to sequential statements, matching the pattern in
        // starter-content.service.ts:batchInsert.
        const deleteStmt = db.delete(serviceInspectors)
            .where(and(eq(serviceInspectors.serviceId, serviceId), eq(serviceInspectors.tenantId, tenantId)));

        if (userIds.length > 0) {
            const now = new Date();
            const insertStmt = db.insert(serviceInspectors).values(
                userIds.map(userId => ({ serviceId, userId, tenantId, createdAt: now })),
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (db as any).batch === 'function') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (db as any).batch([deleteStmt, insertStmt]);
            } else {
                await deleteStmt;
                await insertStmt;
            }
        } else {
            await deleteStmt;
        }

        return userIds.length;
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
        if (dc.expiresAt && new Date(dc.expiresAt) < new Date()) return invalid('Code expired');
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
