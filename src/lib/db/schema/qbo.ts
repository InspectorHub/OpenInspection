import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const qboConnections = sqliteTable('qbo_connections', {
    tenantId:             text('tenant_id').primaryKey(),
    realmId:              text('realm_id').notNull(),
    companyName:          text('company_name'),
    accessToken:          text('access_token').notNull(),
    refreshToken:         text('refresh_token').notNull(),
    tokenExpiresAt:       integer('token_expires_at').notNull(),
    refreshTokenExpiresAt: integer('refresh_token_expires_at').notNull(),
    lastSyncAt:           integer('last_sync_at'),
    syncEnabled:          integer('sync_enabled').notNull().default(1),
    defaultItemId:        text('default_item_id').notNull().default('1'),
    createdAt:            integer('created_at').notNull(),
});

export const qboEntityMap = sqliteTable('qbo_entity_map', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    oiType:       text('oi_type').notNull(),
    oiId:         text('oi_id').notNull(),
    qboType:      text('qbo_type').notNull(),
    qboId:        text('qbo_id').notNull(),
    qboSyncToken: text('qbo_sync_token').notNull(),
    syncedAt:     integer('synced_at').notNull(),
}, (t) => [
    uniqueIndex('idx_qbo_entity_map_qbo').on(t.tenantId, t.qboType, t.qboId),
    uniqueIndex('idx_qbo_entity_map_oi').on(t.tenantId, t.oiType, t.oiId),
]);

export const qboSyncErrors = sqliteTable('qbo_sync_errors', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    oiType:    text('oi_type').notNull(),
    oiId:      text('oi_id').notNull(),
    errorCode: text('error_code').notNull(),
    errorMsg:  text('error_msg').notNull(),
    retries:   integer('retries').notNull().default(0),
    resolved:  integer('resolved').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
});
