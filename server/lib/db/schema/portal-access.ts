import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';

/**
 * Persistent per-(recipient, order) portal access tokens (Magic-Link, no-login).
 *
 * ONE stable row per (inspection, recipient); the token does NOT rotate per
 * email-send (so every automation email/SMS reuses the same link across the
 * order lifecycle — sign → pay → view report → download PDF). Each recipient
 * (client / co_client / agent) gets a distinct token for attribution.
 *
 * Lifecycle: issued on order-create / recipient-add; `expiresAt` set ~30–60d
 * after report delivery; `revokedAt` set by the inspector "Reset access link".
 * Timestamps are plain epoch-ms integers (numeric comparison in the guard).
 * ONE TOKEN OPENS EVERY REPORT ON THE ORDER, deliberately. An order can now
 * deliver several documents — a standard report and a radon report — and the
 * token stays keyed on the INSPECTION, not on a report. One order, one client,
 * one link: a per-report token would mean three links in three emails for one
 * job, and a client who mislaid the middle one.
 *
 * The delivery-confirmation counter (`report_views` below) keys on this row's
 * id: the token says WHO opened something, and — until the public renderer
 * gains per-report identity — the inspection says WHAT, at order granularity.
 *
 * See memory project_client_portal_token_model.
 */
export const inspectionAccessTokens = sqliteTable('inspection_access_tokens', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull().references(() => tenants.id),
    inspectionId:   text('inspection_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    // Free-form role-profile KEY (validated against the tenant's
    // contact_role_profiles by PortalAccessService.issueToken) — NOT a fixed
    // drizzle enum. SQLite stores plain TEXT; this is a type-layer widening
    // only, no DDL/migration cost. See spec 2026-07-16-oi-people-role-profiles.
    role:           text('role').notNull().default('client'),
    token:          text('token').notNull(),
    createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt:      integer('expires_at', { mode: 'timestamp_ms' }),   // null = open (order active)
    revokedAt:      integer('revoked_at', { mode: 'timestamp_ms' }),   // null = live
    tokenHash:      text('token_hash'),
    tokenEnc:       text('token_enc'),
    // GDPR Art. 21 objection to VIEW MEASUREMENT, per recipient (OI #271).
    //
    // When set, `report_views` stops incrementing for this recipient and the
    // link KEEPS WORKING. Suppression, not revocation: an objection to being
    // measured answered by withdrawing the report would be a larger action than
    // the one asked for, and would penalise exercising the right. `revokedAt`
    // is the revocation column and must never be written from this path.
    //
    // A timestamp rather than a boolean because an objection has a date — when
    // the recipient asked is part of the record, and a boolean throws it away.
    //
    // NOT read by any access guard. The check lives at the increment
    // (`server/lib/report-views.ts`); putting it in `resolvePortalAccess` would
    // turn an objection into a revocation on the first bug.
    //
    // Setting this does NOT clear counters already recorded — Art. 21 is not
    // Art. 17. Erasure of the historical rows is a separate request, served by
    // the `report_views` erasure rule.
    //
    // See docs/compliance/report-view-lia.md condition 9.
    //
    // ⚠️ APPENDED AT THE TABLE END on purpose: this table carries a legacy
    // `.references()` to `tenants`, and D1 cannot rebuild an FK-referenced
    // table — a column inserted mid-list makes drizzle emit a full table
    // recreate that fails (or drops the table) on remote D1.
    viewTrackingObjectedAt: integer('view_tracking_objected_at', { mode: 'timestamp_ms' }),
}, (t) => [
    uniqueIndex('idx_iat_token').on(t.token),
    index('idx_iat_inspection').on(t.tenantId, t.inspectionId),
    uniqueIndex('idx_iat_recipient').on(t.inspectionId, t.recipientEmail),
    uniqueIndex('idx_iat_token_hash').on(t.tokenHash),
]);

/**
 * Report delivery confirmation — OI #271. Three counters per (recipient,
 * deliverable-as-observed), written SERVER-SIDE when a report page is actually
 * rendered to a human who presented a live portal token.
 *
 * This is delivery confirmation, NOT engagement analytics. Nothing is stored on
 * or read from the recipient's device — no cookie, pixel, localStorage,
 * sendBeacon, or client listener — so ePrivacy Art. 5(3) is not engaged and the
 * lawful basis is legitimate interests. The full assessment, including the
 * conditions it rests on, is `docs/compliance/report-view-lia.md`.
 *
 * Deliberately absent: IP address, user agent, referrer, device fingerprint,
 * per-section dwell, scroll depth. Each would need its own erasure rule,
 * retention window and justification, and none of them answers "was it
 * received". The absence is the design, not an oversight.
 *
 * WHY THERE IS NO `report_id`. An order can carry several deliverables
 * (`reports` rows of kind primary/ancillary), but the public report surface has
 * no report identity: the route is `report-view/:tenant/:id` where `:id` is an
 * INSPECTION id, and the renderer never sees a `reports.id`. Two shortcuts were
 * rejected. Putting an inspection id in a `report_id` column is a false record
 * in a column whose name asserts otherwise. Guessing the primary report via
 * `resolvePrimaryReportId()` manufactures a specific factual assertion about an
 * identified person ("this recipient opened the radon report") out of an
 * observation that does not contain it — LIA §3.4(b) rejects it on accuracy.
 *
 * So the row records ONLY what the system observed: this recipient rendered the
 * report page for this ORDER. When the renderer gains real per-report identity,
 * a `report_id` column can be appended and the older rows stay honestly
 * order-scoped rather than retroactively mislabelled. (LIA §3.4 option 3;
 * resolves condition 3.)
 *
 * WHO is the access token, not the email: the token row is already one per
 * (inspection, recipient) by unique index, it carries the role, and it is what
 * subject erasure deletes — so keying on it makes these rows die with the
 * recipient's access rather than outlive it.
 *
 * Erasure: rows are DELETED by `access_token_id`, and must be deleted BEFORE
 * `inspection_access_tokens` (the token id is the only locator). An all-zero
 * row would still record that this person was sent this report.
 */
export const reportViews = sqliteTable('report_views', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull(),
    // The ORDER whose report page was rendered. Named `inspection_id`, not
    // `report_id`, because that is what was observed — see the note above.
    inspectionId:  text('inspection_id').notNull(),
    // WHO opened it: `inspection_access_tokens.id`. No `.references()` —
    // referential integrity is the service layer's job (Schema Rules), and an
    // FK here would freeze this table against future column work.
    accessTokenId: text('access_token_id').notNull(),
    firstViewedAt: integer('first_viewed_at', { mode: 'timestamp_ms' }),
    lastViewedAt:  integer('last_viewed_at',  { mode: 'timestamp_ms' }),
    viewCount:     integer('view_count').notNull().default(0),
}, (t) => [
    uniqueIndex('idx_report_views_scope').on(t.tenantId, t.inspectionId, t.accessTokenId),
]);
