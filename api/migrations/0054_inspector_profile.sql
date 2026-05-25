-- Booking #7 Sprint C-1 — public profile page fields for /inspector/<slug>.
-- All nullable; the editorial profile page renders gracefully when missing.
-- service_areas stores JSON `[{"city","state","zip"}]`; parsed by UserService.

ALTER TABLE users ADD COLUMN photo_url      TEXT;
ALTER TABLE users ADD COLUMN bio            TEXT;
ALTER TABLE users ADD COLUMN service_areas  TEXT;
