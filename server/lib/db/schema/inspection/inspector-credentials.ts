import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Inspector Credentials & Association Badges (Spec B) — self-asserted, per-inspector.
// OI ships no association trademark assets; inspectors upload their own images.
// No expiry field by design (Spec B §5). No .references() — FK integrity is
// enforced at the application layer (tenant + user scoping).
export const inspectorCredentials = sqliteTable('inspector_credentials', {
  id:           text('id').primaryKey(),
  tenantId:     text('tenant_id').notNull(),
  userId:       text('user_id').notNull(),
  label:        text('label').notNull(),           // e.g. "InterNACHI CPI"; '' for a pure image row
  memberNumber: text('member_number'),             // NULL ok
  imageR2Key:   text('image_r2_key'),              // NULL = text-only credential
  sortOrder:    integer('sort_order').notNull().default(0),
  active:       integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  index('idx_inspector_credentials_tenant').on(t.tenantId),
  index('idx_inspector_credentials_user').on(t.userId),
]);
