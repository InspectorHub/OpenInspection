import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { inspections } from './inspection';
import { tenants } from './tenant';

export interface MessageAttachment {
    id: string;
    key: string;
    name: string;
    size: number;
    type: string;
    uploadedAt: number;
}

/**
 * Threaded by CONTACT, tagged with the inspection — not the other way round
 * (Communication design §3.9). One thread per counterparty makes the
 * agent-vs-agent leak structurally impossible: the buyer's and listing agents
 * sit on opposite sides of a negotiation, and a per-inspection room would show
 * the listing side the buyer's questions. `WHERE inspection_id` yields the
 * inspection's merged view; `WHERE contact_id` yields a company-wide inbox
 * later for free.
 *
 * - `contactId` — the counterparty whose thread this is. For rows written by
 *   staff it is still the counterparty (whose thread they replied into), never
 *   the author. No `.references()`: new FKs are a permanent D1 migration
 *   liability (Schema Rules); the existing `tenants`/`inspections` FKs below
 *   are frozen legacy.
 * - `inspectionId` — nullable: a message may belong to a contact and no
 *   inspection (pre-booking outreach).
 * - `fromUserId` — which staff member replied; null when the counterparty
 *   sent it. Direction is `fromRole === 'inspector'`; no separate column.
 * - `fromRole` aligns with `contact_role_profiles.kind` so the UI picks a
 *   side without a join.
 */
export const inspectionMessages = sqliteTable('inspection_messages', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').references(() => inspections.id, { onDelete: 'cascade' }),
    // Every consumer tests `!= 'inspector'` rather than naming the counterparty
    // roles — the unread rollup, the mark-read pass, and the notification that
    // fires only for inbound messages — so adding a counterparty role needs no
    // code change, while renaming 'inspector' silently inverts all three.
    fromRole:     text('from_role', { enum: ['inspector', 'client', 'agent', 'other'] }).notNull(),
    fromName:     text('from_name'),
    body:         text('body').notNull(),
    // R2 object metadata written whole at create. It is also the authorization
    // record: resolveAttachmentForInspection scans the messages of an inspection
    // the caller already holds and returns the `key` from here, so an R2 key is
    // never taken from a request. createMessage always writes an array (possibly
    // empty), so NULL is a row no current writer produced.
    attachments:  text('attachments', { mode: 'json' }).$type<MessageAttachment[]>(),
    readAt:       integer('read_at', { mode: 'timestamp_ms' }),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    contactId:    text('contact_id').notNull(),
    fromUserId:   text('from_user_id'),
}, (t) => ({
    inspectionIdx: index('idx_msg_inspection').on(t.inspectionId, t.createdAt),
    contactIdx:    index('idx_msg_contact').on(t.tenantId, t.contactId, t.createdAt),
    unreadIdx:     index('idx_msg_unread')
        .on(t.tenantId, t.contactId, t.fromRole)
        .where(sql`${t.readAt} IS NULL`),
}));
