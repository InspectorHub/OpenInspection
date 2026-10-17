import type { Context } from 'hono';
import { isAdminRole } from '../auth/roles';
import { capabilitiesFor } from '../middleware/require-capability';
import type { HonoConfig } from '../../types/hono';

/**
 * May the caller open another person's calendar or availability?
 *
 * The administrator tier always may. Anyone else needs `scheduleOthers`, the same switch that
 * opens the dispatch board and lets a person reschedule other people's jobs: reading a colleague's
 * day and rearranging it are one privilege. An inspector restricted to their assigned inspections
 * never holds it (the capability set switches it off), so the calendar can never show a restricted
 * person a colleague's jobs the inspection list would hide.
 */
export async function canViewOthersCalendar(c: Context<HonoConfig>): Promise<boolean> {
    if (isAdminRole(c.get('userRole'))) return true;
    return (await capabilitiesFor(c)).scheduleOthers;
}
