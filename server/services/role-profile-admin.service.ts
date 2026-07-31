import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { contactRoleProfiles, messageTemplates } from '../lib/db/schema';
import { capabilitiesForProfile, type RoleCapabilities, type RoleKind } from '../lib/people/capabilities';
import { Errors } from '../lib/errors';

/**
 * Role-profile administration — the settings-page CRUD over
 * `contact_role_profiles` (list/create/update/deactivate + key slugging).
 *
 * Extracted from PeopleService as its base class: same service instance, same
 * `c.var.services.people` call sites, but profile ADMINISTRATION is a cohesive
 * unit apart from people-on-inspection reads, and the two grow independently.
 */
export class RoleProfileAdminService {
    constructor(protected env: { DB: D1Database }) {}
    protected get db() { return drizzle(this.env.DB); }

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

    /** The account track only exists for agent-kind roles today; storing a
     *  switch that redeems nothing would read as "supported, just not wired". */
    private assertOverridesRedeemable(kind: RoleKind, overrides: Partial<RoleCapabilities> | null | undefined) {
        if (overrides?.canHaveAccount === true && kind !== 'agent') {
            throw Errors.BadRequest('Accounts are not yet available for this role type');
        }
    }

    /** Creates a tenant-defined (non-system) role profile with a unique, slugified key. */
    async createProfile(tenantId: string, input: { label: string; kind: RoleKind; emailTemplateId?: string; smsTemplateId?: string; capabilityOverrides?: Partial<RoleCapabilities> | null }) {
        await this.assertTemplatesOwned(tenantId, input.emailTemplateId, input.smsTemplateId);
        this.assertOverridesRedeemable(input.kind, input.capabilityOverrides);
        const key = await this.uniqueKey(tenantId, input.label);
        const now = new Date();
        const row = { id: crypto.randomUUID(), tenantId, key, label: input.label, kind: input.kind,
            emailTemplateId: input.emailTemplateId ?? null, smsTemplateId: input.smsTemplateId ?? null,
            capabilityOverrides: input.capabilityOverrides ?? null,
            isSystem: false, sortOrder: 1000, active: true, createdAt: now, updatedAt: now };
        await this.db.insert(contactRoleProfiles).values(row);
        return row;
    }

    /**
     * Updates label/templates/active/capability overrides. System profiles
     * cannot be deactivated (409). Returns the RESOLVED before/after capability
     * sets when the edit changed them, so the route can audit the diff —
     * permission changes carry who/what/when, label edits stay out of that log.
     */
    async updateProfile(tenantId: string, id: string, patch: { label?: string; emailTemplateId?: string | null; smsTemplateId?: string | null; active?: boolean; capabilityOverrides?: Partial<RoleCapabilities> | null }) {
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
        const kind = cur.kind as RoleKind;
        let capabilityDiff: { before: RoleCapabilities; after: RoleCapabilities } | null = null;
        if (patch.capabilityOverrides !== undefined) {
            this.assertOverridesRedeemable(kind, patch.capabilityOverrides);
            const before = capabilitiesForProfile(kind, cur.capabilityOverrides);
            const after = capabilitiesForProfile(kind, patch.capabilityOverrides);
            if (JSON.stringify(before) !== JSON.stringify(after)) capabilityDiff = { before, after };
        }
        await this.db.update(contactRoleProfiles).set({ ...patch, updatedAt: new Date() })
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.id, id)));
        return { capabilityDiff };
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
