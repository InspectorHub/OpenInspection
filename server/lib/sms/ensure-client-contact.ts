import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { contacts, inspections } from '../db/schema';
import { nanoid } from 'nanoid';

/**
 * Track L (D6b) — guarantee a client contact to attach SMS consent to. Returns
 * the linked contact id if present; else find-or-creates one (dedupe by
 * (tenant,email) when an email exists) and back-links inspections.client_contact_id.
 * Returns null only when the inspection has neither a contact nor any client
 * name/email/phone to create from (degenerate; caller skips consent).
 */
export async function ensureClientContact(
    dbRaw: D1Database, tenantId: string, inspection: typeof inspections.$inferSelect,
): Promise<string | null> {
    const db = drizzle(dbRaw);
    if (inspection.clientContactId) return inspection.clientContactId;

    const email = inspection.clientEmail?.trim() || null;
    const name = inspection.clientName?.trim() || email || inspection.clientPhone?.trim() || null;
    if (!name && !email && !inspection.clientPhone) return null;

    let contactId: string | null = null;
    if (email) {
        const existing = await db.select({ id: contacts.id }).from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, email), isNull(contacts.archivedAt)))
            .get();
        if (existing) contactId = existing.id;
    }
    if (!contactId) {
        contactId = nanoid();
        await db.insert(contacts).values({
            id: contactId, tenantId, type: 'client', name: name ?? 'Client',
            email, phone: inspection.clientPhone ?? null, createdAt: new Date(),
        } as never);
    }
    await db.update(inspections).set({ clientContactId: contactId })
        .where(and(eq(inspections.id, inspection.id), eq(inspections.tenantId, tenantId)));
    return contactId;
}
