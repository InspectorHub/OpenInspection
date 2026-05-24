-- Foundation F3: Add propertyType + commercialSubtype to inspections and templates.
-- Drives template filtering, editor layout branching, and report rendering.
ALTER TABLE inspections ADD COLUMN property_type TEXT;
ALTER TABLE inspections ADD COLUMN commercial_subtype TEXT;

ALTER TABLE templates ADD COLUMN property_type TEXT;
ALTER TABLE templates ADD COLUMN commercial_subtype TEXT;
ALTER TABLE templates ADD COLUMN description TEXT;
ALTER TABLE templates ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
