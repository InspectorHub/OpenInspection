import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema/inspection/core';
import { contacts, contactRoleProfiles, inspectionPeople } from '../../lib/db/schema';

// One-time data move (idempotent via the uq_ip_insp_contact_role index). Reads
// the legacy fixed columns; safe to run before they are dropped.
//
// RETIRED as of Task 13 (DESTRUCTIVE) — clientContactId/clientEmail/
// referredByAgentId/sellingAgentId were dropped from the `inspections`
// schema. Reads through this Drizzle-typed `inspections` import can no
// longer surface those fields (regardless of what a remote row still
// physically holds), so this is now a permanent no-op in code built at or
// after that commit. Deploy runbook: operators must run this against every
// pre-existing-tenant environment BEFORE the Task 13 migration reaches it
// (checked out at the ref just before that commit). Kept for that runbook
// step and for history; do not extend it.
export async function backfillInspectionPeople(db: DrizzleD1Database, tenantId: string): Promise<{ created: number }> {
    const profiles = await db.select().from(contactRoleProfiles).where(eq(contactRoleProfiles.tenantId, tenantId));
    const byKey = new Map(profiles.map(p => [p.key, p.id]));
    const insps = await db.select().from(inspections).where(eq(inspections.tenantId, tenantId));
    let created = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const insp of insps as any[]) {
        // resolve/ensure the primary-client contact id (denorm email fallback)
        let clientContactId: string | null = insp.clientContactId ?? null;
        if (!clientContactId && insp.clientEmail) {
            const c = await db.select({ id: contacts.id }).from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, insp.clientEmail))).get();
            clientContactId = c?.id ?? null;
        }
        const mappings: Array<[string | null, string | undefined]> = [
            [clientContactId,        byKey.get('client')],
            [insp.referredByAgentId, byKey.get('buyer_agent')],
            [insp.sellingAgentId,    byKey.get('listing_agent')],
        ];
        for (const [contactId, roleProfileId] of mappings) {
            if (!contactId || !roleProfileId) continue;
            const res = await db.insert(inspectionPeople).values({
                id: crypto.randomUUID(), tenantId, inspectionId: insp.id, contactId, roleProfileId, createdAt: new Date(),
            }).onConflictDoNothing().returning({ id: inspectionPeople.id });
            created += res.length;
        }
    }
    return { created };
}
