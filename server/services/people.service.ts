import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { contacts, contactRoleProfiles, inspectionPeople } from '../lib/db/schema';
import { capabilitiesForKind, type RoleCapabilities, type RoleKind } from '../lib/people/capabilities';
import { PRIMARY_CLIENT_KEY } from '../lib/people/default-role-profiles';
import { Errors } from '../lib/errors';

export interface PersonRow {
    id: string; contactId: string; roleProfileId: string;
    roleKey: string; roleLabel: string; kind: RoleKind;
    name: string; email: string | null; phone: string | null; agency: string | null;
}

export class PeopleService {
    constructor(private env: { DB: D1Database }) {}
    private get db() { return drizzle(this.env.DB); }

    private async profile(tenantId: string, roleProfileId: string) {
        const row = await this.db.select().from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.id, roleProfileId))).get();
        if (!row) throw Errors.NotFound('Role profile not found');
        return row;
    }

    async addPerson(tenantId: string, inspectionId: string, contactId: string, roleProfileId: string): Promise<void> {
        const prof = await this.profile(tenantId, roleProfileId);
        if (prof.key === PRIMARY_CLIENT_KEY) {
            const existing = await this.db.select({ id: inspectionPeople.id }).from(inspectionPeople)
                .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
                .where(and(
                    eq(inspectionPeople.tenantId, tenantId),
                    eq(inspectionPeople.inspectionId, inspectionId),
                    eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                )).get();
            if (existing) throw Errors.Conflict('An inspection already has a primary client; use co_client for a second buyer.');
        }
        await this.db.insert(inspectionPeople).values({
            id: crypto.randomUUID(), tenantId, inspectionId, contactId, roleProfileId, createdAt: new Date(),
        }).onConflictDoNothing();
    }

    async removePerson(tenantId: string, inspectionPersonId: string): Promise<void> {
        await this.db.delete(inspectionPeople)
            .where(and(eq(inspectionPeople.tenantId, tenantId), eq(inspectionPeople.id, inspectionPersonId)));
    }

    async listPeople(tenantId: string, inspectionId: string): Promise<PersonRow[]> {
        const rows = await this.db.select({
            id: inspectionPeople.id, contactId: contacts.id, roleProfileId: contactRoleProfiles.id,
            roleKey: contactRoleProfiles.key, roleLabel: contactRoleProfiles.label, kind: contactRoleProfiles.kind,
            name: contacts.name, email: contacts.email, phone: contacts.phone, agency: contacts.agency,
        }).from(inspectionPeople)
            .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
            .innerJoin(contacts, eq(inspectionPeople.contactId, contacts.id))
            .where(and(eq(inspectionPeople.tenantId, tenantId), eq(inspectionPeople.inspectionId, inspectionId)));
        return rows as PersonRow[];
    }

    async getPrimaryClient(tenantId: string, inspectionId: string) {
        const row = await this.db.select({
            contactId: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone,
        }).from(inspectionPeople)
            .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
            .innerJoin(contacts, eq(inspectionPeople.contactId, contacts.id))
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
            )).get();
        return row ?? null;
    }

    async roleProfileIdsWithCapability(tenantId: string, cap: keyof RoleCapabilities): Promise<string[]> {
        const rows = await this.db.select({ id: contactRoleProfiles.id, kind: contactRoleProfiles.kind })
            .from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
        return rows.filter(r => capabilitiesForKind(r.kind as RoleKind)[cap]).map(r => r.id);
    }

    async roleKeysWithCapability(tenantId: string, cap: keyof RoleCapabilities): Promise<string[]> {
        const rows = await this.db.select({ key: contactRoleProfiles.key, kind: contactRoleProfiles.kind })
            .from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
        return rows.filter(r => capabilitiesForKind(r.kind as RoleKind)[cap]).map(r => r.key);
    }
}
