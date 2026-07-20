import { PeopleService } from '../../services/people.service';
import { PRIMARY_CLIENT_KEY } from '../people/default-role-profiles';

/**
 * Track L (D6b) — guarantee a client contact to attach SMS consent to.
 * Resolves the inspection's primary client via PeopleService.contactIdForRole
 * (Task 9b/9c — inspection_people is the SOLE source of truth for who the
 * client is). Task 13 dropped inspections.client_contact_id (and
 * client_name/_email/_phone) entirely — there is no legacy cache left to
 * back-link, so this is now a pure resolve. Returns null when the inspection
 * does not exist, or exists but has no primary client at all (degenerate;
 * caller skips consent).
 */
export async function ensureClientContact(
    dbRaw: D1Database, tenantId: string, inspectionId: string,
): Promise<string | null> {
    return new PeopleService({ DB: dbRaw }).contactIdForRole(tenantId, inspectionId, PRIMARY_CLIENT_KEY);
}
