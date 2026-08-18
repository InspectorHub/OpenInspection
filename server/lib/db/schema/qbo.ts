import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const qboConnections = sqliteTable('qbo_connections', {
    tenantId:             text('tenant_id').primaryKey(),
    realmId:              text('realm_id').notNull(),
    companyName:          text('company_name'),
    accessToken:          text('access_token_enc').notNull(),
    refreshToken:         text('refresh_token_enc').notNull(),
    tokenExpiresAt:       integer('token_expires_at', { mode: 'timestamp_ms' }).notNull(),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSyncAt:           integer('last_sync_at', { mode: 'timestamp_ms' }),
    syncEnabled:          integer('is_sync_enabled', { mode: 'boolean' }).notNull().default(true),
    defaultItemId:        text('default_item_id').notNull().default('1'),
    createdAt:            integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const qboEntityMap = sqliteTable('qbo_entity_map', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    // Which OI entity `oi_id` names — 'contact' | 'invoice' | 'refund' at the
    // three insert sites. Part of the (tenant, oi_type, oi_id) unique key, so it
    // is what makes a lookup ask for the QBO twin of THIS row rather than
    // another kind of row that happens to carry the same id.
    oiType:       text('oi_type').notNull(),
    oiId:         text('oi_id').notNull(),
    // The QuickBooks-side entity name of the twin, spelled as Intuit spells it
    // ('Customer' | 'Invoice' | 'CreditMemo'). Paired with `qbo_id` in the
    // reverse unique key — the lookup used when QBO hands back an id and the
    // sync has to find which OI row it belongs to.
    qboType:      text('qbo_type').notNull(),
    qboId:        text('qbo_id').notNull(),
    // QuickBooks' optimistic-concurrency counter for the mapped entity, not an
    // id: it changes on every remote edit. Each update must send the token QBO
    // last returned and store the new one back here; a stale token is the 400
    // the invoice push refetches and retries (up to 3 attempts).
    qboSyncToken: text('qbo_sync_token').notNull(),
    syncedAt:     integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('idx_qbo_entity_map_qbo').on(t.tenantId, t.qboType, t.qboId),
    uniqueIndex('idx_qbo_entity_map_oi').on(t.tenantId, t.oiType, t.oiId),
]);

export const qboSyncErrors = sqliteTable('qbo_sync_errors', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    // The OI entity this open flag is about ('invoice' | 'refund' | 'contact'),
    // part of the (tenant, oi_type, oi_id, error_code) identity of one open row.
    // The bootstrap probe writes ('invoice', 'bootstrap') — an oi_id that is a
    // sentinel, not an invoice id, so joins on oi_id must tolerate a miss.
    oiType:    text('oi_type').notNull(),
    oiId:      text('oi_id').notNull(),
    // WHAT kind of thing a human has to look at, and part of the open-row
    // identity: a failed push ('SYNC_ERROR') and a payment discrepancy
    // (QBO_PAYMENT_DISCREPANCY) on the same invoice are two separate open rows,
    // and sharing one would overwrite each other. The integrations panel reads
    // this to split the discrepancy list out of the plain error list.
    errorCode: text('error_code').notNull(),
    // Not always prose: on a discrepancy row it is the JSON codec payload
    // ({ledgerCents, qboCents}) that the panel decodes to show both figures —
    // the table has no column per figure. On 'SYNC_ERROR' it is the thrown
    // Error's message. Re-detection REFRESHES it in place (and bumps `retries`)
    // instead of appending a row.
    errorMsg:  text('error_msg').notNull(),
    retries:   integer('retries').notNull().default(0),
    resolved:  integer('is_resolved', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * WHEN the operational obligation ended — the retention anchor, and the reason
     * this column exists at all.
     *
     * Counsel round 34 ruled a resolved row expires 90 days after RESOLUTION and
     * that "the retention clock should not be based on created_at": a sync failure
     * left unfixed for a year must not disappear merely because it is old.
     *
     * `updated_at` is not a substitute. It moves on re-detection too — the row is
     * refreshed in place and `retries` bumped — so it answers "when did anything
     * last touch this" rather than "when did this stop being outstanding". Using it
     * would have been an inference dressed as a timestamp.
     *
     * NULL on rows resolved before this column existed, and on every unresolved
     * row. The sweep requires it non-null, so a NULL is never swept — an unknown
     * resolution date fails closed rather than being treated as long ago.
     */
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
});
