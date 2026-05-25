-- Migration: 0009_settings_secrets
-- Adds integration_config (plaintext JSON) and secrets (AES-GCM encrypted JSON)
-- to tenant_configs for UI-managed environment variables.

ALTER TABLE tenant_configs ADD COLUMN integration_config TEXT;
ALTER TABLE tenant_configs ADD COLUMN secrets TEXT;
