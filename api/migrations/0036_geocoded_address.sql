-- Spec 5D — Address Autofill (Phase 1).
-- Adds geocoded fields populated by Google Places Details. All nullable
-- so legacy inspections (free-text address only) still load + edit.
-- Lookup-cache layer lives in TENANT_CACHE KV, not here.

ALTER TABLE inspections ADD COLUMN address_place_id TEXT;
ALTER TABLE inspections ADD COLUMN address_street TEXT;
ALTER TABLE inspections ADD COLUMN address_city TEXT;
ALTER TABLE inspections ADD COLUMN address_state TEXT;
ALTER TABLE inspections ADD COLUMN address_zip TEXT;
ALTER TABLE inspections ADD COLUMN address_county TEXT;
ALTER TABLE inspections ADD COLUMN address_lat REAL;
ALTER TABLE inspections ADD COLUMN address_lng REAL;
ALTER TABLE inspections ADD COLUMN address_geocoded_at INTEGER;

-- Lookup by place_id is rare (debugging only); skip the index for now.
-- Lat/lng index also skipped — not needed until we add map clustering.
