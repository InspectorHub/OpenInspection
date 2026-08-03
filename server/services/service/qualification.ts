/**
 * IA-26 — per-service inspector qualification.
 *
 * Extracted from `service.service.ts` to keep it under the file-size ratchet,
 * and it is a genuinely separate concern: which inspectors MAY perform a
 * catalogue service, as opposed to what that service costs or which lines an
 * inspection carries. ZERO rows for a service means every staff member is
 * qualified — the MVP default — and adding rows restricts it.
 *
 * Takes `db` rather than reading it off a class, matching the other helpers
 * extracted from that file.
 */
import { and, eq, inArray, ne, isNull } from 'drizzle-orm';
import { services, serviceInspectors, users } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
     * Returns the current list of restricted inspector userIds for a service.
     * An empty list means all staff are qualified (no rows = open).
     * Throws 404 if the service does not belong to the given tenant.
     */
export async function getServiceInspectors(db: Db, tenantId: string, serviceId: string): Promise<string[]> {
        const svc = await db.select({ id: services.id }).from(services)
            .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
            .limit(1).get();
        if (!svc) throw Errors.NotFound('Service not found');

        const rows = await db.select({ userId: serviceInspectors.userId }).from(serviceInspectors)
            .where(and(eq(serviceInspectors.serviceId, serviceId), eq(serviceInspectors.tenantId, tenantId)))
            .all();
        return rows.map((r: { userId: string }) => r.userId);
    }

    /**
     * Full-replace the inspector restriction list for a service.
     * Empty userIds = clear all rows (back to "all staff qualified").
     * Validates that every provided userId is a non-deleted, non-agent tenant member.
     * Throws 404 if the service is not found in the tenant; 400 on invalid userIds.
     */
export async function setServiceInspectors(db: Db, tenantId: string, serviceId: string, userIds: string[]): Promise<number> {

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
            const validSet = new Set(validMembers.map((m: { id: string }) => m.id));
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
