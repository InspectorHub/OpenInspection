-- Migration: 0006_tenant_branding.sql
-- Create tenant_configs table for multi-tenant branding support

CREATE TABLE IF NOT EXISTS tenant_configs (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
    site_name TEXT,
    primary_color TEXT,
    logo_url TEXT,
    support_email TEXT,
    billing_url TEXT,
    ga_measurement_id TEXT,
    updated_at INTEGER NOT NULL
);
