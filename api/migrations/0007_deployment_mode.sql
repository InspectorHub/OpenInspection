-- Add deployment_mode column to tenants (shared = pooled DB, silo = dedicated D1)
ALTER TABLE tenants ADD COLUMN deployment_mode TEXT NOT NULL DEFAULT 'shared';
