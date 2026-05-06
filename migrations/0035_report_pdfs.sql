-- Spec 5A.1 — Report PDF Pipeline
-- Tracks pre-rendered Summary + Full Report PDFs per inspection.
-- Pattern mirrors Spectora's PDF flow (HTML -> PDF -> S3-equivalent + signed URLs).
-- Renderer: CF Browser Rendering binding "BROWSER".
-- Storage: R2 bucket "REPORTS" (configured in wrangler.toml [[r2_buckets]]).

CREATE TABLE report_pdfs (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    inspection_id  TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('summary', 'full')),
    r2_key         TEXT NOT NULL,
    rendered_at    INTEGER NOT NULL,
    source_version INTEGER NOT NULL,        -- inspection.updatedAt timestamp at render time
    size_bytes     INTEGER,
    status         TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    error          TEXT
);

CREATE UNIQUE INDEX uq_report_pdfs_inspection_type ON report_pdfs(inspection_id, type);
CREATE INDEX idx_report_pdfs_tenant ON report_pdfs(tenant_id);
CREATE INDEX idx_report_pdfs_status ON report_pdfs(status) WHERE status IN ('queued', 'rendering');
