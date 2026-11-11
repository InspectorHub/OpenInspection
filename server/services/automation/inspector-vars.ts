import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, users } from '../../lib/db/schema';
import { getInspectionRoster } from '../../lib/inspection/roster';

/**
 * Display names for the `{{inspector_name}}` and `{{event_inspector_name}}`
 * merge variables.
 *
 * Only the display name leaves this module: no email, no phone. A user with no
 * name resolves to '' (a blank reads as a template gap, where a guessed
 * stand-in such as the email's local part would publish an address fragment).
 * Every read is scoped to the inspection's own tenant.
 */

/** One user's display name, looked up inside `tenantId` only. */
async function tenantUserName(db: DrizzleD1Database, tenantId: string, userId: string): Promise<string> {
    const row = await db.select({ name: users.name }).from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .get();
    return row?.name?.trim() ?? '';
}

/**
 * The inspection's inspector: the lead on the assignment roster (the same
 * answer every other consumer gets from `getInspectionRoster`), else the
 * legacy `inspections.inspector_id` for a row never re-assigned since the link
 * table existed (the order the SMS recipient resolution uses). Helpers are not
 * "the inspector". Blank when nobody is assigned.
 */
export async function resolveInspectorName(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<string> {
    const roster = await getInspectionRoster(db, tenantId, inspectionId);
    let userId = roster.lead?.id ?? null;
    if (!userId) {
        const row = await db.select({ inspectorId: inspections.inspectorId }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        userId = row?.inspectorId ?? null;
    }
    return userId ? tenantUserName(db, tenantId, userId) : '';
}

/**
 * The inspector of one visit (`inspection_events.inspector_id`), which may
 * legitimately differ from the lead. Blank when the event carries none.
 */
export async function resolveEventInspectorName(
    db: DrizzleD1Database,
    tenantId: string,
    eventInspectorId: string | null | undefined,
): Promise<string> {
    return eventInspectorId ? tenantUserName(db, tenantId, eventInspectorId) : '';
}
