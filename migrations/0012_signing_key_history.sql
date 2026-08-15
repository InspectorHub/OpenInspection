-- Turn `signing_keys` into a key HISTORY so a tenant can change its e-sign key
-- without invalidating everything already signed under the old one.
--
-- Before: `tenant_id` was the primary key, so a tenant had exactly one row and
-- rotating meant overwriting it. That would have destroyed the public key that
-- sealed every existing agreement chain and report version — and both verifiers
-- read the tenant's CURRENT key, so afterwards the PUBLIC verifier page would
-- have reported real signatures on real documents as not checking out. Not
-- "temporarily wrong": the key needed to prove otherwise would no longer exist.
--
-- After: one row per key. `retired_at` NULL marks the active key — the one new
-- signatures are made with — and a retired row keeps its public half forever.
-- The verifiers now resolve a key by the `key_fingerprint` recorded on the row
-- being checked, so old evidence keeps verifying, including a chain that spans a
-- rotation mid-envelope.
--
-- This is a table rebuild rather than an ALTER because the primary key changes,
-- and SQLite cannot alter one in place. It is safe to rebuild here: nothing in
-- the schema references `signing_keys` (its only foreign key points OUT, at
-- `tenants`), so no row anywhere is orphaned by the drop.
--
-- Existing rows migrate as ACTIVE keys, keyed by their own fingerprint. That is
-- a stable, meaningful id and needs no random value — which SQL could not
-- generate reproducibly anyway.
--
-- The guard below is the point of no return. It aborts the migration if the
-- copy did not reproduce every row, BEFORE the original table is dropped; a
-- CHECK violation fails the statement, and D1 stops the migration there with the
-- old table still intact. Do not "fix" a failure by relaxing the check: a
-- shortfall means a key was about to be lost, and a lost public key is evidence
-- that can never be reconstructed.
CREATE TABLE `signing_keys_new` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`public_key` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`private_key_iv` text NOT NULL,
	`fingerprint` text NOT NULL,
	`algorithm` text DEFAULT 'Ed25519' NOT NULL,
	`created_at` integer NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `signing_keys_new`
	(`id`, `tenant_id`, `public_key`, `private_key_enc`, `private_key_iv`, `fingerprint`, `algorithm`, `created_at`, `retired_at`)
SELECT `fingerprint`, `tenant_id`, `public_key`, `private_key_enc`, `private_key_iv`, `fingerprint`, `algorithm`, `created_at`, NULL
FROM `signing_keys`;
--> statement-breakpoint
CREATE TABLE `_guard_signing_keys_copied` (`n` INTEGER NOT NULL CHECK (`n` = 0));
--> statement-breakpoint
INSERT INTO `_guard_signing_keys_copied` (`n`)
SELECT (SELECT COUNT(*) FROM `signing_keys`) - (SELECT COUNT(*) FROM `signing_keys_new`);
--> statement-breakpoint
DROP TABLE `_guard_signing_keys_copied`;
--> statement-breakpoint
DROP TABLE `signing_keys`;
--> statement-breakpoint
ALTER TABLE `signing_keys_new` RENAME TO `signing_keys`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_signing_keys_tenant_fingerprint` ON `signing_keys` (`tenant_id`,`fingerprint`);
--> statement-breakpoint
-- PARTIAL on purpose: at most one ACTIVE key per tenant. A plain unique index on
-- (tenant_id, retired_at) would enforce nothing, because SQLite counts every
-- NULL as distinct — which is exactly the row this must keep singular.
CREATE UNIQUE INDEX `uq_signing_keys_tenant_active` ON `signing_keys` (`tenant_id`) WHERE `retired_at` IS NULL;
