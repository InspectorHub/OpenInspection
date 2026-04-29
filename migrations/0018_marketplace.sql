-- Migration: 0018_marketplace
-- Adds marketplace_templates and tenant_marketplace_imports for versioned snapshot marketplace.

CREATE TABLE IF NOT EXISTS marketplace_templates (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  category       TEXT    NOT NULL
                   CHECK(category IN ('residential','commercial','trec','condo','new_construction')),
  semver         TEXT    NOT NULL,
  schema         TEXT    NOT NULL,
  author_id      TEXT    NOT NULL DEFAULT 'system',
  changelog      TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_marketplace_imports (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL,
  marketplace_template_id TEXT NOT NULL REFERENCES marketplace_templates(id),
  imported_semver         TEXT NOT NULL,
  local_template_id       TEXT NOT NULL REFERENCES templates(id),
  imported_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_imports_tenant ON tenant_marketplace_imports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_imports_tmpl   ON tenant_marketplace_imports(marketplace_template_id);
