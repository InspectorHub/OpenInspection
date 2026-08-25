-- Retire the seventeen AI columns that `tenant_configs` no longer needs.
--
-- This is the CONTRACT half of an expand-migrate-contract. The expand created
-- `tenant_ai_configs` and `tenant_ai_attestations` and repointed every reader
-- and writer; it shipped and DEPLOYED first, deliberately in its own release,
-- because migrations run BEFORE `wrangler deploy` and for the length of that
-- window the previous worker is still serving. Dropping a column it still
-- reads would break production for exactly as long as the deploy takes.
--
-- Why the table had no room: it reached 100 columns, which is D1's hard
-- ceiling for CREATE TABLE. The 101st could not be added at all. After this
-- it sits at 82, and `scripts/check-column-ceiling.mjs` is what keeps score.
--
-- Verified against production immediately before applying, because a fact
-- about production expires: 21 rows, and every one of these columns NULL or
-- at its default -- 0 non-null on ai_base_url, ai_model, ai_provider_kind and
-- all seven ai_key_attestation_*, ai_config_version non-zero on 0 rows,
-- is_courtesy_translation_enabled true on 0. `is_ai_enabled` is true on all
-- 21, which is its DEFAULT rather than anybody's configuration. No data is
-- lost here.
--
-- Also verified: the deployed code has zero references to these columns via
-- `tenantConfigs.<name>`, against a positive control of 117 files that do
-- reference `tenantConfigs.` -- so the search could see what it was looking
-- for. Every remaining `aiBaseUrl` / `aiModel` in the tree is a DTO field, a
-- form input name or a zod key, not a column.
--
-- Native ALTER TABLE ... DROP COLUMN applies to all seventeen: none carries an
-- index (the table's only index is the primary key on tenant_id), none is a
-- primary key, none has an inline UNIQUE or CHECK, no view mentions the table,
-- and nothing holds a foreign key TO it. So this file needs no table rebuild
-- and must never acquire one -- check it with the four-token grep the Schema
-- Rules in CLAUDE.md spell out, which is deliberately not quoted here because
-- quoting it makes the file fail its own check.
-- The ten that MOVED to tenant_ai_configs / tenant_ai_attestations.
-- Readers and writers were repointed in the expand release; these have been
-- dead since it deployed.
ALTER TABLE `tenant_configs` DROP COLUMN `is_ai_enabled`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_base_url`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_model`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_config_version`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `is_courtesy_translation_enabled`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_provider`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_mode`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_account_owner`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_terms_version`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_attested_at`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_policy_version`;--> statement-breakpoint

-- The seven that were never wired, and so did not move: carrying a field
-- nothing writes into a new table only relocates the question of whether it
-- should exist.
--
-- `ai_provider_kind` -- an enum with one member; no code path ever set it.
--
-- The five ai_key_attestation_* below are the "record the destination, not just
-- the key" half of the attestation. `AiKeyAttestationRecord` declares no such
-- fields, so the secrets save could not have written them even in principle.
-- The only thing that ever put a value in them was one spec, inserting them
-- with Drizzle and asserting they came back -- which proves SQLite stores what
-- you give it and nothing about the product. That block was removed with the
-- expand.
--
-- ⚠️ `ai_config_version` is dropped above rather than here, and the difference
-- is worth keeping straight. Production code DID write it, on every save. What
-- was never built is its READER: no call site passes a version to
-- recordProvenance, so ai_call_provenance.config_version is NULL on every row,
-- and the join that was supposed to answer "which configuration was in force
-- when this inspection data was processed" has no left-hand side. The counter
-- survives in tenant_ai_configs.config_version. If that question still matters,
-- the fix is upstream of this file: give recordProvenance the version.
--
-- Dropping these seven is the DECISION this staging exists to make explicit.
-- The alternative is to wire them up -- which starts by adding the fields to
-- AiKeyAttestationRecord, not by keeping the columns. Do not let them be swept
-- away silently as a side effect of the ten above.
ALTER TABLE `tenant_configs` DROP COLUMN `ai_provider_kind`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_endpoint`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_model`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_service_tier`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_intended_use`;--> statement-breakpoint
ALTER TABLE `tenant_configs` DROP COLUMN `ai_key_attestation_config_version`;
