import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { REPAIR_ACTION_TAGS } from '../../repair-action-tag';

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
  // #275 — WHAT THE BUYER IS ASKING FOR on this line: repair it, replace it,
  // give me the money (`fund`), or something else. NULLABLE, and null is not a
  // defect: every item added before this column existed has no tag, and an
  // untagged item stays a valid item forever. Authored by the buyer or their
  // agent only — never the inspector, whose "replace it" would be a
  // professional scope recommendation inside a document the buyer negotiates
  // with (`lib/repair-action-tag.ts` owns both the vocabulary and that rule).
  // Appended at the table end (reference_d1_add_column_at_end).
  //
  // ⚠️ TWO NEIGHBOURING ENUMS LOOK LIKE THIS ONE AND MUST NOT BE MERGED INTO IT:
  //  (a) `cost_items.action` (`schema/inspection/cost-items.ts`) keeps its own
  //      ['repair','replace','further_study']. That is the ASSESSOR classifying
  //      a commercial finding, where `further_study` is a real professional
  //      outcome; this is the buyer stating what they want, where it is not.
  //  (b) our severity vocabulary ['good','marginal','significant','minor'] is a
  //      CONDITION axis. This is the product's first ACTION axis. A condition
  //      and a requested remedy are different statements about a defect, so the
  //      two do not line up and neither can be derived from the other.
  repairActionTag: text('repair_action_tag', { enum: REPAIR_ACTION_TAGS }),
}, (t) => ({
  idxRr: index('idx_repair_request_items_rr').on(t.repairRequestId),
}));

export type RepairRequest = typeof repairRequests.$inferSelect;
export type RepairRequestItem = typeof repairRequestItems.$inferSelect;
