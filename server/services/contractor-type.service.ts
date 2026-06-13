import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { contractorTypes } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { CreateContractorTypeInput, UpdateContractorTypeInput } from '../lib/validations/contractor-type.schema';

export type ContractorType = InferSelectModel<typeof contractorTypes>;

export class ContractorTypeService {
    constructor(private db: D1Database) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async create(tenantId: string, input: CreateContractorTypeInput): Promise<ContractorType> {
        const db = this.getDrizzle();
        const row = { id: crypto.randomUUID(), tenantId, name: input.name, sortOrder: input.sortOrder ?? 0, createdAt: new Date() };
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

    async delete(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.delete(contractorTypes)
            .where(and(eq(contractorTypes.id, id), eq(contractorTypes.tenantId, tenantId)));
    }
}
