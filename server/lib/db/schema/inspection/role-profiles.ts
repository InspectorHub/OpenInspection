import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Tenant-configurable people roles (Spectora "Additional Inspection People"
// parity). `kind` is the ONLY semantic switch — capabilities derive from it in
// server/lib/people/capabilities.ts. New table: app-layer tenant filtering, no
// .references() per Schema Rules. See spec 2026-07-16-oi-people-role-profiles.
export const contactRoleProfiles = sqliteTable('contact_role_profiles', {
    id:              text('id').primaryKey(),
    tenantId:        text('tenant_id').notNull(),
    key:             text('key').notNull(),              // stable machine id, unique per tenant
    label:           text('label').notNull(),            // tenant-editable display name
    kind:            text('kind', { enum: ['client', 'agent', 'other'] }).notNull(),
    emailTemplateId: text('email_template_id'),          // → message_templates.id (optional)
    smsTemplateId:   text('sms_template_id'),
    isSystem:        integer('is_system', { mode: 'boolean' }).notNull().default(false),
    sortOrder:       integer('sort_order').notNull().default(0),
    active:          integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt:       integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:       integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_crp_tenant').on(t.tenantId),
    uniqueIndex('uq_crp_tenant_key').on(t.tenantId, t.key).where(sql`is_active = 1`),
]);

// inspection <-> contact <-> role association. Replaces the fixed people columns
// on inspections (client_*, referred_by_agent_id, selling_agent_id).
export const inspectionPeople = sqliteTable('inspection_people', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull(),
    inspectionId:  text('inspection_id').notNull(),
    contactId:     text('contact_id').notNull(),         // → contacts.id
    roleProfileId: text('role_profile_id').notNull(),    // → contact_role_profiles.id
    createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_ip_inspection').on(t.inspectionId),
    index('idx_ip_tenant').on(t.tenantId),
    uniqueIndex('uq_ip_insp_contact_role').on(t.inspectionId, t.contactId, t.roleProfileId),
]);
