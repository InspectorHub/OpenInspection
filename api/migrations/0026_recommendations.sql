-- Spec 1 — recommendations library + contacts created_by + Standard Residential repair
CREATE TABLE IF NOT EXISTS recommendations (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  category                 TEXT,
  name                     TEXT    NOT NULL,
  severity                 TEXT    NOT NULL CHECK(severity IN ('satisfactory','monitor','defect')),
  default_estimate_min     INTEGER,
  default_estimate_max     INTEGER,
  default_repair_summary   TEXT    NOT NULL,
  created_by_user_id       TEXT,
  created_at               INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recommendations_tenant          ON recommendations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_tenant_category ON recommendations(tenant_id, category);

-- Add nullable created_by_user_id to existing contacts table
ALTER TABLE contacts ADD COLUMN created_by_user_id TEXT;

-- Standard Residential template repair: peel one level from broken rows where
-- the JSON shape is {schema: {sections: ...}} instead of {sections: ...}.
-- Idempotent — only touches rows that match the broken shape.
UPDATE templates
SET schema = json_extract(schema, '$.schema')
WHERE json_array_length(json_extract(schema, '$.sections')) IS NULL
  AND json_array_length(json_extract(schema, '$.schema.sections')) > 0;

-- T1 diagnose found a SECOND corruption type in standalone prod: at least one
-- template row ("Standard Home Inspection") has its schema column stored as a
-- double-serialized JSON string (the outer value is a JSON string containing
-- escaped JSON, not a JSON object). This UPDATE detects and unwraps that case.
-- Idempotent — only touches rows where typeof(schema)='text' AND the unwrapped
-- form has a valid sections array.
UPDATE templates
SET schema = json(schema)
WHERE typeof(schema) = 'text'
  AND substr(schema, 1, 1) = '"'
  AND json_array_length(json_extract(json(schema), '$.sections')) > 0;
