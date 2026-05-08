-- Round-2 backlog G1 / G2 / G3 — competitor parity (Spectora §E.2 + ITB UC-ITB-10).
--
-- G1 Property Facts strip — six numeric / textual property attributes shown
-- on the inspection settings page and as a banner above the published
-- report. Most fields already live as dedicated columns from migration
-- 0016_parity_schema (year_built, sqft, foundation_type, bedrooms, bathrooms).
-- We add `lot_size` (free-text — "0.25 acres" / "10,000 sqft") and a JSON
-- `property_facts` envelope so future facts can land without further DDL.
--
-- G2 Closing Date — already added in 0016 as `closing_date TEXT` (ISO date).
-- No DDL needed, but a comment line keeps the intent visible alongside G1.
--
-- G3 Order ID + Referral Source — `order_id` and `referral_source` columns
-- already exist on inspections. We add `custom_referral_sources` (JSON)
-- to tenant_configs so each workspace can extend the seven seed sources
-- (Realtor / Past Client / Google Search / Facebook / Yelp / Walk-in / Other).

ALTER TABLE inspections ADD COLUMN lot_size       TEXT;
ALTER TABLE inspections ADD COLUMN property_facts TEXT;

ALTER TABLE tenant_configs ADD COLUMN custom_referral_sources TEXT;
