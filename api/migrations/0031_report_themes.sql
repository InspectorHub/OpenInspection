ALTER TABLE tenant_configs ADD COLUMN report_theme TEXT NOT NULL DEFAULT 'modern';
ALTER TABLE inspections    ADD COLUMN report_theme_override TEXT;
