import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    subdomain: text('subdomain').unique().notNull(),
    tier: text('tier').notNull().default('free'),
    stripeConnectAccountId: text('stripe_connect_account_id'),
    status: text('status').notNull().default('pending'),
    maxUsers: integer('max_users').notNull().default(3),
    deploymentMode: text('deployment_mode').notNull().default('shared'), // shared, silo
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    email: text('email').unique().notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    phone: text('phone'),
    licenseNumber: text('license_number'),
    role: text('role').notNull().default('admin'),
    googleRefreshToken: text('google_refresh_token'),
    googleCalendarId: text('google_calendar_id'),
    googleAccessToken: text('google_access_token'),
    googleTokenExpiry: integer('google_token_expiry'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const tenantInvites = sqliteTable('tenant_invites', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    email: text('email').notNull(),
    role: text('role').notNull().default('inspector'),
    status: text('status').notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const tenantConfigs = sqliteTable('tenant_configs', {
    tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
    siteName: text('site_name'),
    primaryColor: text('primary_color'),
    logoUrl: text('logo_url'),
    supportEmail: text('support_email'),
    billingUrl: text('billing_url'),
    gaMeasurementId: text('ga_measurement_id'),
    integrationConfig: text('integration_config'), // plaintext JSON: {appBaseUrl, turnstileSiteKey, googleClientId}
    secrets: text('secrets'),                      // AES-GCM encrypted JSON: {resendApiKey, turnstileSecretKey, geminiApiKey, googleClientSecret}
    icsToken: text('ics_token'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const auditLogs = sqliteTable('audit_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    userId: text('user_id'),
    action: text('action').notNull(),       // e.g. 'inspection.create'
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: text('metadata', { mode: 'json' }),
    ipAddress: text('ip_address'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
    index('idx_audit_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_audit_entity').on(t.entityType, t.entityId),
]);
