import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** A buyer/agent/inspector-built repair-request list for a published report.
 * Multiple lists may exist per inspection (one+ per creator) — Spectora parity. */
export const repairRequests = sqliteTable('repair_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  inspectionId: text('inspection_id').notNull(),
  createdByKind: text('created_by_kind', { enum: ['client', 'agent', 'inspector'] }).notNull(),
  createdByRef: text('created_by_ref').notNull(), // recipient id (client token) / userId (agent,inspector)
  customIntro: text('custom_intro'),
  shareToken: text('share_token').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
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
}, (t) => ({
  idxRr: index('idx_repair_request_items_rr').on(t.repairRequestId),
}));

export type RepairRequest = typeof repairRequests.$inferSelect;
export type RepairRequestItem = typeof repairRequestItems.$inferSelect;
