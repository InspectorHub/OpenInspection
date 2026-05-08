-- Round-2 backlog #9 (Spectora §E.3) — Editor Media Center.
--
-- Spectora's editor exposes a centralized "Media Center" drawer that lists
-- every photo on the inspection (including loose uploads not yet pinned to
-- an item) and lets the inspector drag a card onto any item textarea to
-- attach it. The "attached" half of that view is already derivable from
-- inspection_results.data[*].photos[]; this migration adds the second half:
-- a pool of photos uploaded ahead of placement.
--
-- The pool table is intentionally narrow:
--   - r2_key + url snapshot the R2 object so the drawer can render thumbs
--     without re-resolving the path on every read
--   - exif_data is JSON ({ takenAt, gps?, cameraModel? }) — currently
--     populated only with the take-time when the client extracts it; the
--     drawer's filter sidebar reads `takenAt` for the date facet
--   - uploaded_at drives the default DESC ordering
--
-- Attaching a pool photo to an item moves the photo entry into
-- inspection_results.data[itemId].photos[] and deletes the pool row in
-- the same transaction (see InspectionService.attachPoolPhoto).

CREATE TABLE IF NOT EXISTS inspection_media_pool (
    id           TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    tenant_id    TEXT NOT NULL,
    r2_key       TEXT NOT NULL,
    url          TEXT NOT NULL,
    uploaded_at  INTEGER NOT NULL,
    exif_data    TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_pool_inspection ON inspection_media_pool(inspection_id);
CREATE INDEX IF NOT EXISTS idx_media_pool_tenant     ON inspection_media_pool(tenant_id);
