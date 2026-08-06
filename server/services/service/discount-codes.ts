/**
 * Discount codes — the whole entity, in one place.
 *
 * They lived inside `ServiceService` because a code discounts a service, but
 * they are their own thing with their own lifecycle (mint, validate, redeem,
 * expire) and they were interleaved with the service-line methods rather than
 * grouped, so "how does redemption work" meant reading past three unrelated
 * concerns. Same move `service/qualification.ts` and `service/pay-rules.ts`
 * already made; `ServiceService` keeps thin delegates so no caller changes.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { discountCodes } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import type { CreateDiscountCodeSchema } from '../../lib/validations/service.schema';

type CreateDiscountData = z.infer<typeof CreateDiscountCodeSchema>;

/** `expiresAt` arrives as an ISO string on the wire and a Date in the column. */
export type DiscountCodePatch =
    Partial<Omit<typeof discountCodes.$inferInsert, 'expiresAt'>> & { expiresAt?: string | null };

export interface DiscountValidation {
    valid: boolean;
    discountAmount: number;
    discountCodeId: string | null;
    message?: string;
}

export async function listDiscountCodes(db: DrizzleD1Database, tenantId: string) {
    return db.select().from(discountCodes).where(eq(discountCodes.tenantId, tenantId));
}

export async function createDiscountCode(db: DrizzleD1Database, tenantId: string, data: CreateDiscountData) {
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

export async function updateDiscountCode(
    db: DrizzleD1Database,
    tenantId: string,
    id: string,
    data: DiscountCodePatch,
) {
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

export async function deleteDiscountCode(db: DrizzleD1Database, tenantId: string, id: string): Promise<void> {
    const result = await db.delete(discountCodes)
        .where(and(eq(discountCodes.id, id), eq(discountCodes.tenantId, tenantId)))
        .returning({ id: discountCodes.id });
    if (result.length === 0) throw Errors.NotFound('Discount code not found');
}

export async function validateDiscountCode(
    db: DrizzleD1Database,
    tenantId: string,
    code: string,
    subtotal: number,
): Promise<DiscountValidation> {
    const invalid = (message: string) =>
        ({ valid: false as const, discountAmount: 0, discountCodeId: null, message });

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
export async function redeemDiscountCode(
    db: DrizzleD1Database,
    tenantId: string,
    discountCodeId: string,
): Promise<boolean> {
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
