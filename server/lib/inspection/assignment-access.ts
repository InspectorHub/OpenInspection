/**
 * Who may act on an inspection that is not theirs.
 *
 * One rule, asked in several places (delete, send the report, message the
 * client): owner and manager always; an inspector when they work the inspection
 * (on its roster as lead or helper, or named in `inspections.inspector_id`, the
 * fallback for rows that predate the roster), or when they hold `scheduleOthers`,
 * the capability that already means "act on other people's bookings".
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import { inspections, inspectionInspectors, inspectionPeople } from '../db/schema';
import { isAdminRole } from '../auth/roles';
import { Errors } from '../errors';
import { getDrizzle } from '../route-helpers';
import { getInspectionRoster } from './roster';
import { capabilitiesFor } from '../middleware/require-capability';
import type { HonoConfig } from '../../types/hono';

/** How the caller works this inspection: its lead (roster lead, or the named inspector), a helper, or not at all. */
async function rosterRoleOf(c: Context<HonoConfig>, inspectionId: string): Promise<'lead' | 'helper' | null> {
    const tenantId = c.get('tenantId');
    const userId = c.get('user').sub;
    const db = getDrizzle(c);
    const roster = await getInspectionRoster(db, tenantId, inspectionId);
    if (roster.lead?.id === userId) return 'lead';
    const row = await db.select({ inspectorId: inspections.inspectorId }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
    if (row?.inspectorId === userId) return 'lead';
    return roster.helpers.some((h) => h.id === userId) ? 'helper' : null;
}

const isElevated = (c: Context<HonoConfig>) => isAdminRole(c.get('userRole'));

export async function mayActOnInspection(c: Context<HonoConfig>, inspectionId: string): Promise<boolean> {
    // Owner and manager need no lookup.
    if (isElevated(c)) return true;
    if (await rosterRoleOf(c, inspectionId)) return true;
    return (await capabilitiesFor(c)).scheduleOthers;
}

/**
 * Moving a job. Anyone on the roster (lead or helper) may change the DATE of their own
 * inspection; changing WHO works it, and touching an inspection one is not on, needs
 * `scheduleOthers` (owner has it pinned, manager by default).
 */
export async function mayChangeSchedule(c: Context<HonoConfig>, inspectionId: string, reassigns: boolean): Promise<boolean> {
    // No role shortcut: `scheduleOthers` is the capability a manager's override can revoke.
    if ((await capabilitiesFor(c)).scheduleOthers) return true;
    return !reassigns && (await rosterRoleOf(c, inspectionId)) !== null;
}

/** Deleting: the lead (not a helper), or `scheduleOthers`. Owner and manager always. */
export async function mayDeleteInspection(c: Context<HonoConfig>, inspectionId: string): Promise<boolean> {
    if (isElevated(c)) return true;
    if ((await rosterRoleOf(c, inspectionId)) === 'lead') return true;
    return (await capabilitiesFor(c)).scheduleOthers;
}

export async function assertMayActOnInspection(c: Context<HonoConfig>, inspectionId: string, what: string): Promise<void> {
    if (!(await mayActOnInspection(c, inspectionId))) {
        throw Errors.Forbidden(`Only an inspector assigned to this inspection can ${what}`);
    }
}

/**
 * The same rule for a contact's thread, which spans inspections: allowed when the
 * caller works any inspection the contact is on, holds `scheduleOthers`, or the
 * contact is on no inspection yet (pre-booking outreach belongs to nobody).
 */
export async function mayActOnContact(c: Context<HonoConfig>, contactId: string): Promise<boolean> {
    const role = c.get('userRole') ?? '';
    if (isAdminRole(role)) return true;
    const tenantId = c.get('tenantId');
    const userId = c.get('user').sub;
    const db = getDrizzle(c);
    const seats = await db.select({ id: inspectionPeople.inspectionId }).from(inspectionPeople)
        .where(and(eq(inspectionPeople.tenantId, tenantId), eq(inspectionPeople.contactId, contactId))).all();
    if (seats.length === 0) return true;
    const ids = seats.map((s) => s.id);
    const onRoster = await db.select({ id: inspectionInspectors.inspectionId }).from(inspectionInspectors)
        .where(and(eq(inspectionInspectors.tenantId, tenantId), eq(inspectionInspectors.userId, userId), inArray(inspectionInspectors.inspectionId, ids))).get();
    if (onRoster) return true;
    const named = await db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.inspectorId, userId), inArray(inspections.id, ids))).get();
    return Boolean(named) || (await capabilitiesFor(c)).scheduleOthers;
}
