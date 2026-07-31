-- Task 6 (two-layer role model) — backfill capability_overrides on every
-- existing SYSTEM role row, keyed on `key`, with exactly the values the seed
-- now writes. Every system row then reads the same way as a freshly-seeded
-- one, and the override path is exercised by 100% of system rows.
--
-- Non-system rows stay NULL on purpose and inherit their kind baseline: they
-- were created before the bits existed and no tenant has expressed an intent
-- for them.
--
-- The one deliberate behaviour change rides in these values: listing_agent
-- gains showsInAgentPortal (visible in that agent's portal list), safe only
-- because its canAccessRepairList stays 'off' — the listing agent sees the
-- inspection exists without reading the buyer's negotiation list.
UPDATE contact_role_profiles SET capability_overrides = '{"receivesReport":true,"selfRetrieveReport":true,"canHaveAccount":false,"showsInAgentPortal":false,"canAccessRepairList":"off"}' WHERE is_system = 1 AND key IN ('client', 'co_client');--> statement-breakpoint
UPDATE contact_role_profiles SET capability_overrides = '{"receivesReport":true,"selfRetrieveReport":true,"canHaveAccount":true,"showsInAgentPortal":true,"canAccessRepairList":"readwrite"}' WHERE is_system = 1 AND key = 'buyer_agent';--> statement-breakpoint
UPDATE contact_role_profiles SET capability_overrides = '{"receivesReport":true,"selfRetrieveReport":true,"canHaveAccount":true,"showsInAgentPortal":true,"canAccessRepairList":"off"}' WHERE is_system = 1 AND key = 'listing_agent';--> statement-breakpoint
UPDATE contact_role_profiles SET capability_overrides = '{"receivesReport":true,"selfRetrieveReport":false,"canHaveAccount":false,"showsInAgentPortal":false,"canAccessRepairList":"off"}' WHERE is_system = 1 AND key IN ('attorney', 'transaction_coordinator', 'insurance_agent', 'title_company');
