import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { inspections, contacts, contactRoleProfiles, inspectionPeople } from '../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../lib/people/default-role-profiles';

// Task 9c-X3 — the buyer_agent role join, aliased so it can coexist in the
// same query as the primary-client join above (contactRoleProfiles/
// inspectionPeople/contacts, unaliased) without column/table-name collisions.
const agentRoleProfiles = alias(contactRoleProfiles, 'agent_role_profiles');
const agentPeople = alias(inspectionPeople, 'agent_people');

function csvRow(fields: (string | number | boolean | null | undefined)[]): string {
    return fields.map(f => {
        const s = String(f ?? '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',');
}

export class DataService {
    constructor(private db: D1Database) {}
    private getDrizzle() { return drizzle(this.db); }

    // ── Export ─────────────────────────────────────────────────────────────────

    async exportInspectionsCSV(tenantId: string): Promise<string> {
        const db = this.getDrizzle();
        // Task 9c (people-role-profiles) — client_name/client_email/client_phone
        // are sourced from the inspection_people primary-client join, not the
        // legacy inspections.client_name/_email/_phone columns (frozen cache,
        // dropped Task 13). A single LEFT JOIN keeps this bulk export N+1-free
        // (contact_role_profiles filtered to 'client' before joining
        // inspection_people, same join order as api/metrics.ts).
        const rows = await db.select({
            inspection: inspections,
            primaryClientName:  contacts.name,
            primaryClientEmail: contacts.email,
            primaryClientPhone: contacts.phone,
            buyerAgentContactId: agentPeople.contactId,
        }).from(inspections)
            .leftJoin(contactRoleProfiles, and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                eq(contactRoleProfiles.active, true),
            ))
            .leftJoin(inspectionPeople, and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ))
            .leftJoin(contacts, and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ))
            // Task 9c-X3 — buyer_agent attribution for the `referred_by_agent_id`
            // export column, aliased to coexist with the primary-client join
            // above. Role filter joined FIRST (contact_role_profiles narrowed to
            // this tenant's buyer_agent profile) so the inspection_people join
            // only ever matches buyer_agent rows — joining inspection_people
            // first would fan out over every role on the inspection. Replaces
            // the legacy inspections.referredByAgentId column read.
            .leftJoin(agentRoleProfiles, and(
                eq(agentRoleProfiles.tenantId, inspections.tenantId),
                eq(agentRoleProfiles.key, 'buyer_agent'),
                eq(agentRoleProfiles.active, true),
            ))
            .leftJoin(agentPeople, and(
                eq(agentPeople.roleProfileId, agentRoleProfiles.id),
                eq(agentPeople.inspectionId, inspections.id),
                eq(agentPeople.tenantId, inspections.tenantId),
            ))
            .where(eq(inspections.tenantId, tenantId))
            .orderBy(inspections.date);

        const header = csvRow([
            'id', 'date', 'property_address', 'unit', 'client_name', 'client_email', 'client_phone',
            'status', 'payment_status', 'price_cents', 'year_built', 'sqft', 'foundation_type',
            'bedrooms', 'bathrooms', 'county', 'inspector_id', 'referred_by_agent_id',
            'confirmed_at', 'cancel_reason', 'internal_notes', 'created_at',
        ]);
        const dataRows = rows.map(({ inspection: r, primaryClientName, primaryClientEmail, primaryClientPhone, buyerAgentContactId }) => csvRow([
            r.id, r.date, r.propertyAddress, r.unit, primaryClientName, primaryClientEmail, primaryClientPhone,
            r.status, r.paymentStatus, r.price,
            r.yearBuilt, r.sqft, r.foundationType, r.bedrooms, r.bathrooms, r.county,
            r.inspectorId, buyerAgentContactId,
            r.confirmedAt instanceof Date ? r.confirmedAt.toISOString() : r.confirmedAt,
            r.cancelReason, r.internalNotes,
            r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        ]));
        return [header, ...dataRows].join('\n');
    }

    async exportContactsCSV(tenantId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select().from(contacts)
            .where(eq(contacts.tenantId, tenantId));

        const header = csvRow(['id', 'type', 'name', 'email', 'phone', 'agency', 'notes', 'created_at']);
        const dataRows = rows.map(r => csvRow([
            r.id, r.type, r.name, r.email, r.phone, r.agency, r.notes,
            r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        ]));
        return [header, ...dataRows].join('\n');
    }
}
