import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Public concierge booking flow (Tasks 15-17 of typed-hono-dead-routes-cleanup).
 *
 * `concierge_invites` — single-use magic-link token an inspector hands out so a
 * customer can open the public booking page WITHOUT a JWT. The URL ?token=
 * value is the secret.
 *
 * `concierge_bookings` — the row written when the customer submits the public
 * booking form. The `confirmation_token` is then handed to /confirm-info so the
 * just-booked customer can see their own details one more time.
 *
 * Distinct from the older `concierge_confirm_tokens` table (which models the
 * agent-mediated state-machine in `inspection.ts`); the two flows coexist and
 * will be unified in a follow-up calendar-integration plan.
 */
export const conciergeInvites = sqliteTable('concierge_invites', {
    token: text('token').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    inspectorId: text('inspector_id'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const conciergeBookings = sqliteTable('concierge_bookings', {
    id: text('id').primaryKey(),
    confirmationToken: text('confirmation_token').notNull().unique(),
    tenantId: text('tenant_id').notNull(),
    inviteToken: text('invite_token').notNull(),
    slotStart: text('slot_start').notNull(),
    slotEnd: text('slot_end').notNull(),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone'),
    address: text('address').notNull(),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
