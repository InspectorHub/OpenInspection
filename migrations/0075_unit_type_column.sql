-- Foundation F2: Add 'type' column to inspection_units.
-- Separates hierarchy level (kind: building/floor/unit) from purpose
-- (type: unit/common). Extensible to 'amenity', 'parking' etc.
ALTER TABLE inspection_units ADD COLUMN type TEXT NOT NULL DEFAULT 'unit';
