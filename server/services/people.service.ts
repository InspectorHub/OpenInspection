import { drizzle } from 'drizzle-orm/d1';
import { and, eq, sql } from 'drizzle-orm';
import { contacts, contactRoleProfiles, inspectionPeople, messageTemplates } from '../lib/db/schema';
import { capabilitiesForProfile, type RoleCapabilities, type RoleKind } from '../lib/people/capabilities';
import { PRIMARY_CLIENT_KEY, SECONDARY_CLIENT_KEY } from '../lib/people/default-role-profiles';
import { Errors } from '../lib/errors';

export interface PersonRow {
    id: string; contactId: string; roleProfileId: string;
    roleKey: string; roleLabel: string; kind: RoleKind;
    name: string; email: string | null; phone: string | null; agency: string | null;
    /** Raw per-profile overrides; resolve with capabilitiesForProfile(kind, this). */
    capabilityOverrides: unknown;
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

    /**
     * Assign a contact to a role on an inspection.
     *
     * Returns whether a row was actually created. The insert is idempotent by
     * design — `onConflictDoNothing` against the unique
     * (inspection, contact, role) index, which is what keeps a double-submit or
     * a retry safe — but idempotent is not the same as "nothing to say" (IA-133).
     *
     * The People modal reported every 200 as success and closed, so re-adding
     * someone already on the inspection looked exactly like adding them. That
     * mattered because the modal's own notice told operators that re-adding
     * reissues a revoked report link. It does not, and cannot: report tokens are
     * unique per (inspection, recipient), so there is no second row to mint. An
     * operator following that advice to restore a revoked agent got a success
     * dialog and no access. Saying `added: false` is what lets the UI tell them
     * to use "Reset access link" instead.
     */
    async addPerson(tenantId: string, inspectionId: string, contactId: string, roleProfileId: string): Promise<{ added: boolean }> {
        const prof = await this.profile(tenantId, roleProfileId);

        // Already holds exactly this seat — the case the operator hits when they
        // re-add someone to "refresh" their access. Checked before the primary
        // branch below, which has its own hand-over semantics for a DIFFERENT
        // contact taking the seat and would otherwise mask this.
        const existing = await this.db.select({ id: inspectionPeople.id }).from(inspectionPeople)
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.contactId, contactId),
                eq(inspectionPeople.roleProfileId, roleProfileId),
            )).get();
        if (existing) return { added: false };

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
            // Did our contact take the seat? If someone else holds it, the seat
            // HANDS OVER rather than the add failing (IA-36 ⑬): the incumbent
            // stays on the inspection as co-client and the caller's pick becomes
            // primary. Refusing here is what left a mis-picked wizard client with
            // no way out except editing the shared contact record.
            const winner = await this.db.select({ contactId: inspectionPeople.contactId }).from(inspectionPeople)
                .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
                .where(and(
                    eq(inspectionPeople.tenantId, tenantId),
                    eq(inspectionPeople.inspectionId, inspectionId),
                    eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                )).get();
            if (winner && winner.contactId === contactId) return { added: true };
            await this.handOverPrimary(tenantId, inspectionId, contactId, roleProfileId);
            return { added: true };
        }
        await this.db.insert(inspectionPeople).values({
            id: crypto.randomUUID(), tenantId, inspectionId, contactId, roleProfileId, createdAt: new Date(),
        }).onConflictDoNothing();
        return { added: true };
    }

    /**
     * Seat the contact (adding them as co-client first if they are not on the
     * inspection yet), then run the same atomic swap `makePrimary` uses. The
     * insert is idempotent and benign on its own — if the swap fails the worst
     * outcome is a visible extra co-client row, never a client-less inspection.
     */
    private async handOverPrimary(tenantId: string, inspectionId: string, contactId: string, primaryProfileId: string): Promise<void> {
        const coClientProfileId = await this.profileIdForKey(tenantId, SECONDARY_CLIENT_KEY);
        if (!coClientProfileId) {
            // The co-client seat is a system profile and cannot be deleted, so
            // this is unreachable in practice — but demoting someone into a role
            // that does not exist would drop them off the inspection entirely.
            throw Errors.Conflict('An inspection already has a primary client, and this company has no co-client role to move them to.');
        }
        await this.db.insert(inspectionPeople).values({
            id: crypto.randomUUID(), tenantId, inspectionId, contactId,
            roleProfileId: coClientProfileId, createdAt: new Date(),
        }).onConflictDoNothing();
        const seated = await this.db.select({ id: inspectionPeople.id }).from(inspectionPeople)
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.contactId, contactId),
                eq(inspectionPeople.roleProfileId, coClientProfileId),
            )).get();
        if (!seated) throw Errors.Conflict('Could not seat the new primary client on this inspection.');
        await this.swapPrimary(tenantId, inspectionId, seated.id, primaryProfileId, coClientProfileId);
    }

    /**
     * Move the primary-client seat onto `inspectionPersonId` (IA-36 ⑫⑬).
     *
     * "Primary" is the role key, so moving it is a swap of two role_profile_id
     * values — no new column, no second source of truth, and `getPrimaryClient`
     * and every existing query keep working untouched.
     *
     * The demoted incumbent is NOT revoked: they are still on the inspection as
     * a co-client, so their report link is still legitimately theirs. Only
     * leaving the inspection (remove) takes access away.
     */
    async makePrimary(tenantId: string, inspectionId: string, inspectionPersonId: string): Promise<void> {
        const target = await this.db.select({
            id: inspectionPeople.id, key: contactRoleProfiles.key, kind: contactRoleProfiles.kind,
        }).from(inspectionPeople)
            .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.id, inspectionPersonId),
            )).get();
        if (!target) throw Errors.NotFound('Person not found on this inspection');
        if (target.key === PRIMARY_CLIENT_KEY) return; // already the primary client
        // An agent or attorney is not a buyer. Offering "make primary" on those
        // rows would hand them the client's capabilities (agreements, payment,
        // report delivery) purely by relabelling.
        if (target.kind !== 'client') throw Errors.BadRequest('Only a client-type person can become the primary client');

        const primaryProfileId = await this.profileIdForKey(tenantId, PRIMARY_CLIENT_KEY);
        const coClientProfileId = await this.profileIdForKey(tenantId, SECONDARY_CLIENT_KEY);
        if (!primaryProfileId || !coClientProfileId) throw Errors.Conflict('This company has no client / co-client role to move the seat between.');
        await this.swapPrimary(tenantId, inspectionId, inspectionPersonId, primaryProfileId, coClientProfileId);
    }

    /**
     * The swap itself: ONE statement, so the inspection is never observed with
     * two primary clients or none. The CASE promotes the target row and demotes
     * whoever currently holds the primary profile; the WHERE limits it to
     * exactly those two rows of this tenant's inspection.
     */
    private async swapPrimary(
        tenantId: string, inspectionId: string, targetPersonId: string,
        primaryProfileId: string, coClientProfileId: string,
    ): Promise<void> {
        try {
            await this.db.run(sql`
                UPDATE inspection_people
                SET role_profile_id = CASE WHEN id = ${targetPersonId} THEN ${primaryProfileId} ELSE ${coClientProfileId} END
                WHERE tenant_id = ${tenantId} AND inspection_id = ${inspectionId}
                  AND (id = ${targetPersonId} OR role_profile_id = ${primaryProfileId})
            `);
        } catch {
            // uq (inspection_id, contact_id, role_profile_id): the incumbent
            // already occupies the co-client seat on this inspection too.
            throw Errors.Conflict('That person already holds the co-client role on this inspection; remove the duplicate first.');
        }
    }

    async removePerson(tenantId: string, inspectionId: string, inspectionPersonId: string): Promise<{ email: string | null }> {
        // Resolve the recipient email BEFORE the delete so the caller can revoke
        // this person's report-access token (IA-36): removing someone from an
        // inspection must stop their report link, which otherwise stays live
        // forever. Returned rather than revoked here to keep PeopleService free
        // of the portal-access dependency.
        const row = await this.db.select({ email: contacts.email })
            .from(inspectionPeople)
            .innerJoin(contacts, eq(inspectionPeople.contactId, contacts.id))
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.id, inspectionPersonId),
            ))
            .get();
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
        return { email: row?.email ?? null };
    }

    async listPeople(tenantId: string, inspectionId: string): Promise<PersonRow[]> {
        const rows = await this.db.select({
            id: inspectionPeople.id, contactId: contacts.id, roleProfileId: contactRoleProfiles.id,
            roleKey: contactRoleProfiles.key, roleLabel: contactRoleProfiles.label, kind: contactRoleProfiles.kind,
            capabilityOverrides: contactRoleProfiles.capabilityOverrides,
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
        const rows = await this.db.select({
            id: contactRoleProfiles.id, kind: contactRoleProfiles.kind,
            capabilityOverrides: contactRoleProfiles.capabilityOverrides,
        })
            .from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
        return rows.filter(r => Boolean(capabilitiesForProfile(r.kind as RoleKind, r.capabilityOverrides)[cap])).map(r => r.id);
    }

    async roleKeysWithCapability(tenantId: string, cap: keyof RoleCapabilities): Promise<string[]> {
        const rows = await this.db.select({
            key: contactRoleProfiles.key, kind: contactRoleProfiles.kind,
            capabilityOverrides: contactRoleProfiles.capabilityOverrides,
        })
            .from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
        return rows.filter(r => Boolean(capabilitiesForProfile(r.kind as RoleKind, r.capabilityOverrides)[cap])).map(r => r.key);
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
