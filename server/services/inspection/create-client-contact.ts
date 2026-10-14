import { and, eq, isNull } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { isUniqueViolation } from '../../lib/db/unique-violation';
import { contacts } from '../../lib/db/schema/contact';
import { logger } from '../../lib/logger';

/**
 * Soft-upsert the client of a new inspection into Contacts so it shows up in
 * the Contacts list for future re-use (search, agent linking). Idempotent on
 * tenantId+email (or tenantId+name when there is no email). Failures are
 * non-fatal: inspection creation must not break because of a contact-side
 * issue. Returns the contact id to link, or `current` when nothing was resolved.
 *
 * An address is matched the way it is stored (trimmed, lower case) and without
 * regard to the contact's type: the unique index is one live contact per
 * (tenant, e-mail), so a broker who is also a client IS the contact to link, and
 * a person plays a different role on each inspection through `inspection_people`.
 * When another writer takes the address between the look-up and the insert, the
 * index refuses the insert and the winner is looked up again and reused.
 *
 * `rethrow` is for a create that can be retried (a client-chosen id): there a
 * swallowed failure would leave the inspection without its client for good, so
 * the failure is raised and the retry runs this step again.
 */
export async function softUpsertClientContact(
    db: ReturnType<typeof drizzle>,
    tenantId: string,
    client: { name: string; email: string | null; phone: string | null; createdAt: Date },
    current: string | null,
    inspectionId: string,
    opts?: { rethrow?: boolean },
): Promise<string | null> {
    const email = client.email ? client.email.trim().toLowerCase() : null;
    const find = async () => {
        const matchConds = [eq(contacts.tenantId, tenantId)];
        if (email) matchConds.push(eq(contacts.email, email), isNull(contacts.archivedAt));
        else matchConds.push(eq(contacts.type, 'client'), eq(contacts.name, client.name));
        return db.select({ id: contacts.id }).from(contacts).where(and(...matchConds)).get();
    };
    try {
        const existing = await find();
        if (existing) return current ?? existing.id;
        const newContactId = crypto.randomUUID();
        try {
            await db.insert(contacts).values({
                id: newContactId,
                tenantId,
                type: 'client',
                name: client.name,
                email,
                phone: client.phone,
                agency: null,
                notes: null,
                createdAt: client.createdAt,
            });
        } catch (err) {
            if (!email || !isUniqueViolation(err, 'contacts.email')) throw err;
            const winner = await find();
            if (!winner) throw err;
            return current ?? winner.id;
        }
        return current ?? newContactId;
    } catch (err) {
        if (opts?.rethrow) throw err;
        logger.error('contact upsert from inspection failed', { inspectionId }, err instanceof Error ? err : undefined);
        return current;
    }
}
