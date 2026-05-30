-- Inspection sync conflicts (Tasks 12-14 of typed-hono-dead-routes-cleanup)
-- Persists field-level merge conflicts detected by inspection-sync.ts so the
-- conflict-resolver UI can query them via GET /api/inspections/:id/conflicts
-- instead of relying solely on the transient 409 sync response.
CREATE TABLE IF NOT EXISTS inspection_conflicts (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    section_id TEXT,
    field TEXT NOT NULL,
    base TEXT,
    local TEXT,
    remote TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inspection_conflicts_inspection
    ON inspection_conflicts(inspection_id, resolved_at);
