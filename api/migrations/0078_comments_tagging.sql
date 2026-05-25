-- P3: Comments library tagging enhancement for auto-filter.
-- Adds structured fields alongside existing free-text category/section.
ALTER TABLE comments ADD COLUMN section_ids TEXT;       -- JSON array of section IDs
ALTER TABLE comments ADD COLUMN item_labels TEXT;       -- JSON array of item label keywords
ALTER TABLE comments ADD COLUMN trigger_code TEXT;      -- short code for '/' trigger
ALTER TABLE comments ADD COLUMN search_keywords TEXT;   -- denormalized searchable text
