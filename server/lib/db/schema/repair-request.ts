import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** A buyer/agent/inspector-built repair-request list for a published report.
 * Multiple lists may exist per inspection (one+ per creator) — Spectora parity. */
export const repairRequests = sqliteTable('repair_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  inspectionId: text('inspection_id').notNull(),
  createdByKind: text('created_by_kind', { enum: ['client', 'agent', 'inspector'] }).notNull(),
  // WHO built this list, as resolved by `repair-access.ts`. NOT an opaque id:
  // on the portal-token path (how a client always arrives, and most agents) it
  // is the recipient's EMAIL ADDRESS. It is a userId only for the owner-preview
  // inspector and for an agent on a logged-in agent-portal session, and the raw
  // token string for the legacy KV agent link. Personal data in the common
  // case, which is why it carries an erasure rule (erasure-manifest.ts).
  createdByRef: text('created_by_ref').notNull(),
  customIntro: text('custom_intro'),
  shareToken: text('share_token').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  // IA-37 — share-token lifecycle (mirrors agreement_signers). Appended at the
  // table end (reference_d1_add_column_at_end). NULL expiresAt = never expires;
  // revokedAt set = link killed. Public share resolution fails closed on either.
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  idxInspection: index('idx_repair_requests_inspection').on(t.tenantId, t.inspectionId),
  uqShare: uniqueIndex('idx_repair_requests_share_token').on(t.shareToken),
}));

export const repairRequestItems = sqliteTable('repair_request_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  repairRequestId: text('repair_request_id').notNull(),
  findingKey: text('finding_key').notNull(),
  sectionTitle: text('section_title').notNull(),
  itemLabel: text('item_label').notNull(),
  commentSnapshot: text('comment_snapshot'),
  requestedCreditCents: integer('requested_credit_cents'),
  note: text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
  // IA-55 — defect title / location / category snapshots so the public share
  // page shows a locatable, distinguishable, priority-tagged list that stays
  // stable after the report changes. Appended at the table end (D1 can't add a
  // column mid-table on a referenced table — reference_d1_add_column_at_end).
  defectTitleSnapshot: text('defect_title_snapshot'),
  locationSnapshot: text('location_snapshot'),
  categorySnapshot: text('category_snapshot'),
  // IA-57 — the recommended trade ("who fixes this"), snapshotted at add time
  // so the contractor reading the shared list knows which trade to send. Stores
  // the RESOLVED LABEL ("licensed roofer"), not the DEFECT_TRADES slug: the
  // label is what the report card shows, so both surfaces read identically, and
  // a snapshot must not depend on a lookup table that can change under it.
  // Appended at the table end (reference_d1_add_column_at_end).
  tradeSnapshot: text('trade_snapshot'),
}, (t) => ({
  idxRr: index('idx_repair_request_items_rr').on(t.repairRequestId),
}));

export type RepairRequest = typeof repairRequests.$inferSelect;
export type RepairRequestItem = typeof repairRequestItems.$inferSelect;
