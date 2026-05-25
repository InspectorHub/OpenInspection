-- B2: Embeddable Booking Widget — per-tenant origin allowlist for cross-origin embeds.
-- JSON array of allowed origin strings, e.g. ["https://acme.com", "https://www.acme.com"].
-- NULL means widget is not enabled for this tenant.
ALTER TABLE tenant_configs ADD COLUMN widget_allowed_origins TEXT;
