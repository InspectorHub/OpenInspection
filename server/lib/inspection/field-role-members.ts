import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../db/schema';
import { FIELD_ROLES } from '../auth/roles';
import { Errors } from '../errors';

/**
 * Throws 400 unless every id names a member of this tenant who can be assigned
 * as an inspector (a field role: not staff or an agent). Null and
 * empty ids are ignored; with nothing to check there is no database read.
 */
export async function assertFieldRoleMembers(
    db: DrizzleD1Database,
    tenantId: string,
    ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;
    const found = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, wanted), inArray(users.role, [...FIELD_ROLES])))
        .all();
    if (found.length !== wanted.length) {
        throw Errors.BadRequest('An assignee is not a member of this tenant who can inspect');
    }
}
