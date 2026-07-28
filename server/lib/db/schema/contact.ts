import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant';

export const contacts = sqliteTable('contacts', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    type: text('type', { enum: ['agent', 'client', 'other'] }).notNull().default('client'),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    agency: text('agency'),
    notes: text('notes'),
    createdByUserId: text('created_by_user_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // DB-9: soft-delete timestamp. When set, the row is excluded from the
    // active-contact unique index so a replacement active row can coexist.
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),

    // ── Agent account binding (IA-104) ────────────────────────────────────
    // Absorbed from the former `agent_tenant_links` table. That table held
    // (agent_user_id, tenant_id, inspector_contact_id, status, revoked_at) —
    // a join row whose only purpose was to point at a contact in a tenant it
    // already knew. `contacts` carries the tenant AND is the thing being
    // pointed at, so the join row was addressing its own destination.
    //
    // Collapsing it removes a whole class of bug: the pointer was written
    // once at signup and never updated, so contact churn left links aimed at
    // superseded rows (see IA-103). A column on the row cannot go stale
    // relative to the row.

    /** The global agent account (users.tenant_id IS NULL, role='agent') this
     *  contact is. NULL is the norm: an agent reads reports through a
     *  per-inspection token and only gets an account if they want a standing
     *  cross-inspector view. */
    agentUserId: text('agent_user_id'),
    /** When the account was bound. Null iff agent_user_id is null. */
    agentLinkedAt: integer('agent_linked_at', { mode: 'timestamp_ms' }),
    /** Set when the tenant revokes this agent's standing account access.
     *  Distinct from `archived_at`: archiving retires the CONTACT, revoking
     *  only severs the account binding while the contact stays usable. */
    agentRevokedAt: integer('agent_revoked_at', { mode: 'timestamp_ms' }),
}, (t) => [
    index('idx_contacts_type').on(t.tenantId, t.type),
    index('idx_contacts_tenant').on(t.tenantId),
    // DB-9: one ACTIVE contact per (tenant,email); NULL emails and archived rows don't collide.
    uniqueIndex('uq_contacts_tenant_email').on(t.tenantId, t.email).where(sql`email IS NOT NULL AND archived_at IS NULL`),
    // IA-104 — replaces agent_tenant_links' UNIQUE (agent_user_id, tenant_id).
    // Scoped to LIVE rows so that archiving a contact frees the slot: the old
    // table's unconditional constraint is precisely what stranded a link on a
    // dead contact when a tenant re-added the same person.
    uniqueIndex('uq_contacts_tenant_agent_user').on(t.tenantId, t.agentUserId)
        .where(sql`agent_user_id IS NOT NULL AND archived_at IS NULL`),
    // The agent portal's cross-tenant lookup: "every tenant that is me".
    index('idx_contacts_agent_user').on(t.agentUserId),
]);

/**
 * The contact type union, DERIVED from the column above rather than restated.
 *
 * Six call sites used to spell out `'agent' | 'client'` by hand, so widening
 * the set (IA-96 added 'other') meant finding all six. Deriving it means the
 * column is the only place the values live, and the next one propagates by
 * compiling rather than by being remembered.
 *
 * The values mirror `contact_role_profiles.kind` on purpose: a contact created
 * from an inspection role inherits that role's kind directly, so the two
 * vocabularies must stay the same size.
 */
export type ContactType = typeof contacts.$inferSelect['type'];
