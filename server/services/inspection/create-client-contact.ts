import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { contacts } from '../../lib/db/schema/contact';
import { logger } from '../../lib/logger';

/**
 * Soft-upsert the client of a new inspection into Contacts so it shows up in
 * the Contacts list for future re-use (search, agent linking). Idempotent on
 * tenantId+email (or tenantId+name when there is no email). Failures are
 * non-fatal: inspection creation must not break because of a contact-side
 * issue. Returns the contact id to link, or `current` when nothing was resolved.
 */
export async function softUpsertClientContact(
    db: ReturnType<typeof drizzle>,
    tenantId: string,
    client: { name: string; email: string | null; phone: string | null; createdAt: Date },
    current: string | null,
    inspectionId: string,
): Promise<string | null> {
    try {
        const matchConds = [eq(contacts.tenantId, tenantId), eq(contacts.type, 'client')];
        if (client.email) matchConds.push(eq(contacts.email, client.email));
        else matchConds.push(eq(contacts.name, client.name));
        const existing = await db.select().from(contacts).where(and(...matchConds)).get();
        if (existing) return current ?? existing.id;
        const newContactId = crypto.randomUUID();
        await db.insert(contacts).values({
            id: newContactId,
            tenantId,
            type: 'client',
            name: client.name,
            email: client.email,
            phone: client.phone,
            agency: null,
            notes: null,
            createdAt: client.createdAt,
        });
        return current ?? newContactId;
    } catch (err) {
        logger.error('contact upsert from inspection failed', { inspectionId }, err instanceof Error ? err : undefined);
        return current;
    }
}
