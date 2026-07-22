import { drizzle } from 'drizzle-orm/d1';
import { and, eq, sql } from 'drizzle-orm';
import { contacts, contactRoleProfiles, inspectionPeople, messageTemplates } from '../lib/db/schema';
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
            // Atomic insert-if-no-existing-client. A bare SELECT-then-INSERT leaves
            // a TOCTOU race open: two concurrent adds of DIFFERENT client contacts
            // both pass the existence check and both land, giving the inspection
            // two primary clients (getPrimaryClient then returns a nondeterministic
            // one). D1 serializes writes, so an INSERT ... SELECT ... WHERE NOT
            // EXISTS evaluates the guard against committed rows and only one wins.
            // ON CONFLICT keeps the same-contact idempotent dedup. See #258 review.
            await this.db.run(sql`
                INSERT INTO inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at)
                SELECT ${crypto.randomUUID()}, ${tenantId}, ${inspectionId}, ${contactId}, ${roleProfileId}, ${Date.now()}
                WHERE NOT EXISTS (
                    SELECT 1 FROM inspection_people ip
                    JOIN contact_role_profiles crp ON ip.role_profile_id = crp.id
                    WHERE ip.tenant_id = ${tenantId} AND ip.inspection_id = ${inspectionId} AND crp.key = ${PRIMARY_CLIENT_KEY}
                )
                ON CONFLICT (inspection_id, contact_id, role_profile_id) DO NOTHING
            `);
            // Verify our contact now holds the client role; if a different contact
            // won the race (or was already the client), surface the friendly 409.
            const winner = await this.db.select({ contactId: inspectionPeople.contactId }).from(inspectionPeople)
                .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
                .where(and(
                    eq(inspectionPeople.tenantId, tenantId),
                    eq(inspectionPeople.inspectionId, inspectionId),
                    eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                )).get();
            if (!winner || winner.contactId !== contactId) {
                throw Errors.Conflict('An inspection already has a primary client; use co_client for a second buyer.');
            }
            return;
        }
        await this.db.insert(inspectionPeople).values({
            id: crypto.randomUUID(), tenantId, inspectionId, contactId, roleProfileId, createdAt: new Date(),
        }).onConflictDoNothing();
    }

    async removePerson(tenantId: string, inspectionId: string, inspectionPersonId: string): Promise<void> {
        // Scope the delete to the URL's inspection as well as the tenant — the
        // personId path segment is asserted to belong to `inspectionId`, so a
        // person row from a DIFFERENT inspection (same tenant) must not be
        // deletable via /inspections/:id/people/:personId. See #258 review.
        await this.db.delete(inspectionPeople)
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.id, inspectionPersonId),
            ));
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

    /**
     * Resolves the single contact id occupying `roleKey` on an inspection (e.g.
     * the buyer's-agent or listing-agent contact), replacing the legacy
     * `inspections.referredByAgentId` / `.sellingAgentId` column reads. Returns
     * null when no `inspection_people` row carries that role for this
     * inspection. Does not join `contacts` — callers that also need contact
     * fields (email, name, ...) should follow up with their own tenant-scoped
     * `contacts` lookup, same shape as the legacy two-step column read.
     */
    async contactIdForRole(tenantId: string, inspectionId: string, roleKey: string): Promise<string | null> {
        const row = await this.db.select({ contactId: inspectionPeople.contactId })
            .from(inspectionPeople)
            .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(contactRoleProfiles.key, roleKey),
            )).get();
        return row?.contactId ?? null;
    }

    /**
     * Resolves a role profile `key` (e.g. 'client', 'buyer_agent', 'listing_agent')
     * to its per-tenant `contact_role_profiles.id`, or null when the tenant has no
     * active profile for that key. Shared helper for callers that persist a
     * recipient discriminator (recipientKind='role' + recipientRoleProfileId) —
     * e.g. automation seed writers mapping their stable role-key shorthand to a
     * real profile id. The `uq_crp_tenant_key` unique index is partial on
     * `is_active = 1`, so the active filter is required to hit that index.
     */
    async profileIdForKey(tenantId: string, key: string): Promise<string | null> {
        const row = await this.db.select({ id: contactRoleProfiles.id }).from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, key),
                eq(contactRoleProfiles.active, true),
            )).get();
        return row?.id ?? null;
    }

    /**
     * Resolves a role profile `key`'s `kind` (client/agent/other) for the
     * tenant, or null when no ACTIVE profile matches. Used by the agent
     * magic-login primitive (server/services/agent/magic-login.service.ts) to
     * confirm a portal-access grant's role KEY is agent-kind before minting a
     * session — the grant itself only carries the key, never the kind.
     */
    async kindForKey(tenantId: string, key: string): Promise<RoleKind | null> {
        const row = await this.db.select({ kind: contactRoleProfiles.kind }).from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, key),
                eq(contactRoleProfiles.active, true),
            )).get();
        return (row?.kind as RoleKind | undefined) ?? null;
    }

    /** Lists all role profiles (active + inactive) for the tenant, in display order. */
    async listProfiles(tenantId: string) {
        return this.db.select().from(contactRoleProfiles)
            .where(eq(contactRoleProfiles.tenantId, tenantId))
            .orderBy(contactRoleProfiles.sortOrder);
    }

    /** Rejects any template id that is not an active row in THIS tenant's
     *  message_templates — a role profile must never reference another tenant's
     *  (or a bogus) template id. Null/undefined ids are allowed (no reference). */
    private async assertTemplatesOwned(tenantId: string, emailTemplateId?: string | null, smsTemplateId?: string | null) {
        for (const id of [emailTemplateId, smsTemplateId]) {
            if (!id) continue;
            const row = await this.db.select({ id: messageTemplates.id }).from(messageTemplates)
                .where(and(eq(messageTemplates.tenantId, tenantId), eq(messageTemplates.id, id))).get();
            if (!row) throw Errors.NotFound('Message template not found');
        }
    }

    /** Creates a tenant-defined (non-system) role profile with a unique, slugified key. */
    async createProfile(tenantId: string, input: { label: string; kind: RoleKind; emailTemplateId?: string; smsTemplateId?: string }) {
        await this.assertTemplatesOwned(tenantId, input.emailTemplateId, input.smsTemplateId);
        const key = await this.uniqueKey(tenantId, input.label);
        const now = new Date();
        const row = { id: crypto.randomUUID(), tenantId, key, label: input.label, kind: input.kind,
            emailTemplateId: input.emailTemplateId ?? null, smsTemplateId: input.smsTemplateId ?? null,
            isSystem: false, sortOrder: 1000, active: true, createdAt: now, updatedAt: now };
        await this.db.insert(contactRoleProfiles).values(row);
        return row;
    }

    /** Updates label/templates/active. System profiles cannot be deactivated (409). */
    async updateProfile(tenantId: string, id: string, patch: { label?: string; emailTemplateId?: string | null; smsTemplateId?: string | null; active?: boolean }) {
        const cur = await this.db.select().from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.id, id))).get();
        if (!cur) throw Errors.NotFound('Role profile not found');
        if (cur.isSystem && patch.active === false) throw Errors.Conflict('System role profiles cannot be deactivated');
        if (patch.emailTemplateId !== undefined || patch.smsTemplateId !== undefined) {
            await this.assertTemplatesOwned(tenantId, patch.emailTemplateId, patch.smsTemplateId);
        }
        // Reactivating a profile whose key collides with an already-active profile
        // would hit the partial unique index `uq_crp_tenant_key` (WHERE is_active=1)
        // and surface a raw SQLite constraint error (500). Map it to a clean 409.
        if (patch.active === true && !cur.active) {
            const clash = await this.db.select({ id: contactRoleProfiles.id }).from(contactRoleProfiles)
                .where(and(
                    eq(contactRoleProfiles.tenantId, tenantId),
                    eq(contactRoleProfiles.key, cur.key),
                    eq(contactRoleProfiles.active, true),
                )).get();
            if (clash) throw Errors.Conflict('Another active role profile already uses this key');
        }
        await this.db.update(contactRoleProfiles).set({ ...patch, updatedAt: new Date() })
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.id, id)));
    }

    /** Soft-deletes (deactivates) a role profile. System profiles cannot be deleted (409). */
    async deactivateProfile(tenantId: string, id: string) {
        const cur = await this.db.select().from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.id, id))).get();
        if (!cur) throw Errors.NotFound('Role profile not found');
        if (cur.isSystem) throw Errors.Conflict('System role profiles cannot be deleted');
        await this.db.update(contactRoleProfiles).set({ active: false, updatedAt: new Date() })
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.id, id)));
    }

    /** Slugifies `label` into a stable machine key, disambiguating collisions with a numeric suffix. */
    private async uniqueKey(tenantId: string, label: string): Promise<string> {
        const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'role';
        let key = base, n = 1;
        while (await this.db.select({ id: contactRoleProfiles.id }).from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.key, key))).get()) {
            key = `${base}_${++n}`;
        }
        return key;
    }
}
