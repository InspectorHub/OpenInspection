-- Design System 0520 subsystem E — consolidated schema additions.
--
-- Three independent additions land in a single migration so the
-- subsystem ships with one new file:
--
--   1. inspections.cover_photo_id     — points at an inspection_media_pool
--                                       row used as the report cover. Null
--                                       means "no cover chosen yet"; the
--                                       Publish pre-flight surfaces this.
--   2. tenants.nachi_number           — opt-in InterNACHI inspector ID
--                                       displayed in the TeamCredit footer.
--   3. user_identity_links            — many-to-one mapping that lets a
--                                       primary user identity switch into
--                                       linked admin/inspector seats from
--                                       the IdentitySwitcher (M20).

ALTER TABLE inspections ADD COLUMN cover_photo_id TEXT;
ALTER TABLE tenants     ADD COLUMN nachi_number   TEXT;

CREATE TABLE user_identity_links (
    id                  TEXT PRIMARY KEY,
    primary_user_id     TEXT NOT NULL,
    linked_user_id      TEXT NOT NULL,
    linked_tenant_id    TEXT NOT NULL,
    linked_role         TEXT NOT NULL,
    linked_display_name TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (primary_user_id, linked_user_id)
);
CREATE INDEX user_identity_links_primary_idx ON user_identity_links (primary_user_id);
