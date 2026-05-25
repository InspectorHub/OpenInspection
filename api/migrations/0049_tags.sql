-- Sprint 3 S3-3 — T-key Tag system.
--
-- Two new tables:
--   tags                       — tenant-scoped tag library (name + colour, seedable).
--   inspection_item_tag_links  — many-to-many link between an inspection-item
--                                position (inspection_id + item_id) and a tag.
--
-- Tags are internal-only — they never render on the customer-facing report.
-- Inspector workflow: T hotkey on inspection-edit opens a picker popover;
-- multi-select links/unlinks tags onto the active item.
--
-- See docs/superpowers/plans/2026-05-08-sprint3-polish-ga.md § S3-3 for the
-- full design.
CREATE TABLE tags (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  color       TEXT,
  is_seed     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);
CREATE INDEX idx_tags_tenant ON tags(tenant_id);

CREATE TABLE inspection_item_tag_links (
  inspection_id TEXT    NOT NULL,
  item_id       TEXT    NOT NULL,
  tag_id        TEXT    NOT NULL,
  tenant_id     TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (inspection_id, item_id, tag_id)
);
CREATE INDEX idx_tag_links_tenant            ON inspection_item_tag_links(tenant_id);
CREATE INDEX idx_tag_links_inspection_item   ON inspection_item_tag_links(inspection_id, item_id);
CREATE INDEX idx_tag_links_tag               ON inspection_item_tag_links(tag_id);
