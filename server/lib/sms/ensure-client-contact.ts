import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../db/schema';
import { PeopleService } from '../../services/people.service';

/**
 * Track L (D6b) — guarantee a client contact to attach SMS consent to. Returns
 * the already-linked contact id when present; otherwise resolves the
 * inspection's primary client via PeopleService.getPrimaryClient (Task 9b —
 * inspection_people is the source of truth for who the client is, superseding
 * the dropped inspections.client_name/_email/_phone columns) and back-links
 * inspections.client_contact_id to that already-existing contact. Returns
 * null when the inspection does not exist, or exists but has no primary
 * client at all (degenerate; caller skips consent).
 */
export async function ensureClientContact(
    dbRaw: D1Database, tenantId: string, inspectionId: string,
): Promise<string | null> {
    const db = drizzle(dbRaw);
    const insp = await db.select({ clientContactId: inspections.clientContactId })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp) return null;
    if (insp.clientContactId) return insp.clientContactId;

    const client = await new PeopleService({ DB: dbRaw }).getPrimaryClient(tenantId, inspectionId);
    if (!client) return null;

    await db.update(inspections).set({ clientContactId: client.contactId })
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    return client.contactId;
}
