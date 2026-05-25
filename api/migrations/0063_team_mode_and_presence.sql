ALTER TABLE inspections ADD COLUMN team_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inspections ADD COLUMN lead_inspector_id TEXT;
ALTER TABLE inspections ADD COLUMN helper_inspector_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE inspections ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_active_at INTEGER;
