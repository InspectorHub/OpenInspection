import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/**
 * One recipient's answer to "send me this or don't", per notification class
 * per channel.
 *
 * ONE SUBJECT COLUMN, NOT TWO. The obvious shape is a nullable `user_id` and a
 * nullable `contact_id` with a rule that exactly one is set. SQLite treats
 * NULLs as DISTINCT in a unique index, so `(t1, NULL, 'c1', 'email')` does not
 * conflict with itself — the constraint meant to guarantee one row per
 * (who, what, how) would silently permit duplicates, and a duplicate here means
 * two contradictory answers with no rule for which wins. `subjectKind` +
 * `subjectId` are both NOT NULL, so the index actually holds and the
 * two-columns-one-truth state cannot be written.
 *
 * `subjectKind` distinguishes an ACCOUNT holder (staff, agent — rows in
 * `users`) from a CONTACT (a client with no login — rows in `contacts`). They
 * are different id spaces that can collide, so the kind is part of the key, not
 * a hint.
 *
 * ABSENCE IS NOT "OFF". No row means the class's default applies, which is
 * "send". Only an explicit `enabled = false` suppresses, and only for a class
 * `isSuppressible()` allows — see `server/lib/notifications/classes.ts`, which
 * fails closed on ids it has never heard of. A preference can therefore never
 * silence a notification the recipient is told is always sent.
 *
 * Erasure: rows here are deleted with their subject. A contact id can be
 * reused after an erasure, and inheriting the erased person's mute settings
 * would be both wrong and invisible.
 */
export const notificationPreferences = sqliteTable('notification_preferences', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull(),
    /** Which id space `subjectId` belongs to. */
    subjectKind: text('subject_kind', { enum: ['user', 'contact'] }).notNull(),
    subjectId:   text('subject_id').notNull(),
    /** A `NOTIFICATION_CLASSES` id. Not a template trigger — those are a subset. */
    classId:     text('class_id').notNull(),
    channel:     text('channel', { enum: ['email', 'sms', 'in_app'] }).notNull(),
    enabled:     integer('enabled', { mode: 'boolean' }).notNull(),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:   integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // One answer per (who, what, how). Every column is NOT NULL, so this
    // constraint is real rather than NULL-defeated.
    uniqueIndex('idx_notification_prefs_unique')
        .on(t.tenantId, t.subjectKind, t.subjectId, t.classId, t.channel),
    // The send-boundary read: "what has this subject muted?"
    index('idx_notification_prefs_subject').on(t.tenantId, t.subjectKind, t.subjectId),
]);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
