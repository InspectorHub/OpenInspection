-- Move the AI subsystem off `tenant_configs`, which had reached D1's hard
-- ceiling of 100 columns per table and could not accept another field.
--
-- NO BACKFILL, and that is a measured fact rather than an omission. Checked
-- against production before writing this: 21 tenant_configs rows, and every AI
-- column NULL or at its default on every one of them -- ai_base_url, ai_model,
-- ai_key_attestation_provider and the rest all count 0 non-null. No workspace
-- has ever configured AI, so there is nothing to copy across. An absent row in
-- `tenant_ai_configs` reads exactly as the old defaults did (enabled true,
-- endpoint and model unset), so the readers need no transitional case either.
--
-- Seven columns are deliberately NOT represented here -- see the comment on
-- `tenantAiConfigs` for which and why. They stay on `tenant_configs` until a
-- separate contract migration retires them, together with the ten this
-- supersedes. That drop cannot ride this migration: migrations apply BEFORE the
-- new worker deploys, so for the length of that window the previous worker is
-- still reading the old columns.

CREATE TABLE `tenant_ai_attestations` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`account_owner` text NOT NULL,
	`terms_version` text NOT NULL,
	`attested_at` integer NOT NULL,
	`policy_version` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tenant_ai_configs` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`base_url` text,
	`model` text,
	`config_version` integer DEFAULT 0 NOT NULL,
	`is_courtesy_translation_enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
