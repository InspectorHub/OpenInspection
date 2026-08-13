import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc, count } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { contractorTypes, comments } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { CreateContractorTypeInput, UpdateContractorTypeInput } from '../lib/validations/contractor-type.schema';

export type ContractorType = InferSelectModel<typeof contractorTypes>;

export class ContractorTypeService {
    constructor(private db: D1Database) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async create(tenantId: string, input: CreateContractorTypeInput): Promise<ContractorType> {
        const db = this.getDrizzle();
        // `tradeSlug` is null and stated, not omitted: a tenant-created type has
        // no counterpart in the canonical vocabulary, and the response schema
        // declares the field, so leaving it off would serve a shape the schema
        // says cannot happen. The slug is the seeder's to assign, never a
        // caller's.
        const row = { id: crypto.randomUUID(), tenantId, name: input.name, sortOrder: input.sortOrder ?? 0, tradeSlug: null, createdAt: new Date() };
        await db.insert(contractorTypes).values(row);
        return row as ContractorType;
    }

    async listByTenant(tenantId: string): Promise<ContractorType[]> {
        const db = this.getDrizzle();
        return db.select().from(contractorTypes)
            .where(eq(contractorTypes.tenantId, tenantId))
            .orderBy(asc(contractorTypes.sortOrder), asc(contractorTypes.name)).all();
    }

    async update(id: string, tenantId: string, patch: UpdateContractorTypeInput): Promise<ContractorType> {
        const db = this.getDrizzle();
        const updates: Partial<ContractorType> = {};
        if (patch.name !== undefined) updates.name = patch.name;
        if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
        await db.update(contractorTypes).set(updates)
            .where(and(eq(contractorTypes.id, id), eq(contractorTypes.tenantId, tenantId)));
        const row = await db.select().from(contractorTypes)
            .where(and(eq(contractorTypes.id, id), eq(contractorTypes.tenantId, tenantId))).get();
        if (!row) throw Errors.NotFound('Contractor type not found');
        return row;
    }

    async reorder(tenantId: string, ids: string[]): Promise<void> {
        const db = this.getDrizzle();
        for (let i = 0; i < ids.length; i++) {
            await db.update(contractorTypes).set({ sortOrder: i })
                .where(and(eq(contractorTypes.id, ids[i]!), eq(contractorTypes.tenantId, tenantId)));
        }
    }

    /**
     * How much a delete would orphan.
     *
     * `comments.recommendedContractorTypeId` is a soft reference by design — the
     * schema says so and says a stale ref is acceptable — so this exists to make
     * the cost visible, NOT to block. Published reports are unaffected either
     * way: repair items store the resolved label, not the id.
     */
    async countReferences(id: string, tenantId: string): Promise<{ comments: number }> {
        const db = this.getDrizzle();
        const row = await db
            .select({ n: count() })
            .from(comments)
            .where(and(
                eq(comments.recommendedContractorTypeId, id),
                eq(comments.tenantId, tenantId),
            ))
            .get();
        return { comments: row?.n ?? 0 };
    }

    async delete(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.delete(contractorTypes)
            .where(and(eq(contractorTypes.id, id), eq(contractorTypes.tenantId, tenantId)));
    }
}
