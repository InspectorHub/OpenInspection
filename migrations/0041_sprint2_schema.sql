-- Sprint 2 Track 1 schema bundle — multi-rating system (S2-1) +
-- recommendation_id contractor categories (S2-3) + repair estimate range
-- (S2-4). All three changes ship in one migration so we avoid two destructive
-- D1 resets while the system is still pre-launch.

-- ─── S2-1 Multi-rating system ──────────────────────────────────────────────
-- A tenant-scoped library of rating systems. `levels` stores the canonical
-- ordered level list as JSON (id / abbr / label / color / bucket / hotkey /
-- order). Seed systems carry is_seed=1 so the service layer can refuse edits
-- and force a clone-first workflow. `is_default=1` selects the system used
-- for templates that don't bind one explicitly.
CREATE TABLE IF NOT EXISTS rating_systems (
    id           TEXT    PRIMARY KEY,
    tenant_id    TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    slug         TEXT    NOT NULL,
    description  TEXT,
    levels       TEXT    NOT NULL,            -- JSON array of RatingLevel objects
    is_default   INTEGER NOT NULL DEFAULT 0,
    is_seed      INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_rating_systems_tenant
    ON rating_systems(tenant_id);

-- Templates select exactly one rating system. Nullable: when null, the
-- service falls back to the tenant's default rating system.
ALTER TABLE templates ADD COLUMN rating_system_id TEXT;
CREATE INDEX IF NOT EXISTS idx_templates_rating_system
    ON templates(rating_system_id);

-- Inspection results carry the active rating system snapshot at creation
-- time so that editing the source rating system later does not retroactively
-- mutate any in-flight or published inspection. Snapshot stores the full
-- levels[] payload (≤ 10 levels × ~8 fields = a few hundred bytes).
ALTER TABLE inspection_results ADD COLUMN rating_system_id TEXT;
ALTER TABLE inspection_results ADD COLUMN rating_system_snapshot TEXT;

-- ─── S2-3 / S2-4 — defect JSON shape extensions ───────────────────────────
-- defects[].recommendation_id (string slug from a hardcoded enum) and
-- defects[].estimate_low / defects[].estimate_high (integer cents) live
-- inside the JSON payload of inspection_results.data — no DDL change is
-- required. Service-layer Zod schemas gate the new fields. The existing
-- inspection.service.ts already surfaces res.recommendation / res.estimateMin
-- / res.estimateMax for legacy single-defect items; Sprint 2 adds
-- per-defect-card variants.

-- ─── S2-4 — tenant-level toggle for showing estimates ─────────────────────
-- When 1, published reports render "Estimated cost: $X – $Y" badges on each
-- defect card that carries an estimate range. Defaults to 0 so existing
-- tenants don't suddenly start showing dollar figures.
ALTER TABLE tenant_configs ADD COLUMN show_estimates INTEGER NOT NULL DEFAULT 0;
