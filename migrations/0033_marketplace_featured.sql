-- Spec 4F — featured flag on marketplace templates for sort priority.
ALTER TABLE marketplace_templates ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
