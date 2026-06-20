import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import { inspectionTypes } from '../lib/db/schema';

// Settings + Library IA — tenant-defined inspection subtypes. Mirrors the
// EventService event-type CRUD shape; every query filters by tenantId (no DB
// FKs per Schema Rules — isolation is enforced here in the service layer).
export class InspectionTypeService {
    constructor(private db: D1Database) {}

    async listInspectionTypes(tenantId: string) {
        return drizzle(this.db).select().from(inspectionTypes)
            .where(eq(inspectionTypes.tenantId, tenantId))
            .orderBy(asc(inspectionTypes.sortOrder)).all();
    }

    async createInspectionType(tenantId: string, data: Record<string, unknown>) {
        const row = {
            id:        crypto.randomUUID(),
            tenantId,
            createdAt: new Date(),
            enabled:   true,
            ...data,
        } as typeof inspectionTypes.$inferInsert;
        await drizzle(this.db).insert(inspectionTypes).values(row).run();
        return row;
    }

    async updateInspectionType(tenantId: string, id: string, data: Record<string, unknown>) {
        await drizzle(this.db).update(inspectionTypes).set(data as never)
            .where(and(eq(inspectionTypes.id, id), eq(inspectionTypes.tenantId, tenantId))).run();
    }

    async deleteInspectionType(tenantId: string, id: string): Promise<void> {
        await drizzle(this.db).delete(inspectionTypes)
            .where(and(eq(inspectionTypes.id, id), eq(inspectionTypes.tenantId, tenantId))).run();
    }
}
