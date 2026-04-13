import { drizzle } from 'drizzle-orm/d1';
import { eq, and, SQL } from 'drizzle-orm';
import * as schema from './schema';

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A Scoped DB wrapper that automatically injects tenantId filters into queries.
 * This implements a "Fail-Closed" security model by default.
 */
export class ScopedDB {
    constructor(private db: DrizzleDB, private tenantId: string) {}

    /**
     * Automatic Tenant Filter for any table that has a tenantId column.
     */
    private withTenant(table: any, condition?: SQL | undefined): SQL {
        const tenantFilter = eq(table.tenantId, this.tenantId);
        return condition ? and(tenantFilter, condition) : tenantFilter;
    }

    /**
     * Scoped Select: Returns a pre-filtered query based on ID and Tenant.
     */
    async getById<T extends { id: any; tenantId: any }>(table: any, id: string): Promise<any> {
        return this.db.select()
            .from(table)
            .where(this.withTenant(table, eq(table.id, id)))
            .get();
    }

    /**
     * Scoped List: Returns all records for the current tenant with optional conditions.
     */
    async list<T extends { tenantId: any }>(table: any, condition?: SQL): Promise<any[]> {
        return this.db.select()
            .from(table)
            .where(this.withTenant(table, condition))
            .all();
    }

    /**
     * Scoped Update: Ensures the update only happens if the record belongs to the tenant.
     */
    async update<T extends { id: any; tenantId: any }>(table: any, id: string, data: any) {
        return this.db.update(table)
            .set(data)
            .where(this.withTenant(table, eq(table.id, id)));
    }

    /**
     * Scoped Delete: Ensures the deletion only happens if the record belongs to the tenant.
     */
    async delete<T extends { id: any; tenantId: any }>(table: any, id: string) {
        return this.db.delete(table)
            .where(this.withTenant(table, eq(table.id, id)));
    }

    /**
     * Scoped Insert: Automatically injects the tenantId into the data.
     */
    async insert<T extends { tenantId: any }>(table: any, data: any) {
        return this.db.insert(table).values({
            ...data,
            tenantId: this.tenantId
        });
    }

    /**
     * Access the raw database if complex joins are needed, 
     * but try to use scoped methods for simple CRUD.
     */
    get raw() {
        return this.db;
    }
}

export const createScopedDb = (db: DrizzleDB, tenantId: string) => {
    return new ScopedDB(db, tenantId);
};
