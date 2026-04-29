import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import { services, inspectionServices, discountCodes } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import type { CreateServiceSchema, UpdateServiceSchema, CreateDiscountCodeSchema } from '../lib/validations/service.schema';

type CreateServiceData  = z.infer<typeof CreateServiceSchema>;
type UpdateServiceData  = z.infer<typeof UpdateServiceSchema>;
type CreateDiscountData = z.infer<typeof CreateDiscountCodeSchema>;

export class ServiceService {
    constructor(private db: D1Database) {}

    private getDrizzle() { return drizzle(this.db as any); }

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
}
