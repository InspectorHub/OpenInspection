import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../db/schema';
import { PeopleService } from '../../services/people.service';
import { PRIMARY_CLIENT_KEY } from '../people/default-role-profiles';

/**
 * Track L (D6b) — guarantee a client contact to attach SMS consent to.
 * Resolves the inspection's primary client via PeopleService.contactIdForRole
 * (Task 9b/9c — inspection_people is the SOLE source of truth for who the
 * client is, superseding the dropped inspections.client_name/_email/_phone
 * columns, and the legacy client_contact_id column is no longer trusted as a
 * read fast-path either) and back-links inspections.client_contact_id to that
 * already-existing contact so the still-legacy readers of that cache
 * (automation, contact.service, ...) stay in sync. Returns null when the
 * inspection does not exist, or exists but has no primary client at all
 * (degenerate; caller skips consent).
 */
export async function ensureClientContact(
    dbRaw: D1Database, tenantId: string, inspectionId: string,
): Promise<string | null> {
    const contactId = await new PeopleService({ DB: dbRaw }).contactIdForRole(tenantId, inspectionId, PRIMARY_CLIENT_KEY);
    if (!contactId) return null;

    const db = drizzle(dbRaw);
    await db.update(inspections).set({ clientContactId: contactId })
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    return contactId;
}
