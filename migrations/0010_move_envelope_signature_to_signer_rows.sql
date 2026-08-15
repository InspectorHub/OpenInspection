-- Move the envelope-level client signature onto the signer row that made it,
-- then drop `agreement_requests.signature_base64`.
--
-- WHAT THIS COLUMN IS. Not a dead column: `erasure-manifest.ts` declares it
-- `user.biometric.signature`, action `retain`, legal basis art_17_3_e, P6Y,
-- enforcement `enforced`. It is retained EVIDENCE. This migration therefore
-- relocates it and does not destroy it — `agreement_signers.signature_base64`
-- carries the identical manifest declaration, so the evidence keeps its
-- category, its basis and its retention period, and gains a named author it
-- never had here.
--
-- WHY MOVE IT. A signature belongs to the person who made it. Completion used
-- to copy one up to the envelope, which on a multi-signer envelope meant
-- whichever signature won the completion race, stored as though the envelope
-- had an author of its own. That copy is gone from the code; this moves the
-- rows it left behind. Provenance columns come from the migration before this
-- one, and every row written here records which rule attributed it and what
-- that rule read (review review, 2026-08-15).
--
-- THE TWO CASES, AND THE ONE THAT IS NOT HANDLED.
--   exactly one signer row  -> the signature is that person's; copy it down.
--   zero signer rows        -> a pre-signer-model envelope; synthesize the one
--                              client signer it always implied, carrying the
--                              signature, with the identity taken from the
--                              envelope's recipient fields. Mirrors
--                              `synthesizeDefaultSigner`, except that function
--                              copies `status` WITHOUT the signature, which is
--                              why it cannot be relied on to do this.
--   more than one signer row, none carrying a signature -> NOT handled, on
--                              purpose, and review has ruled this must stay a
--                              hard failure. No normal path produces it: signing
--                              writes the signer's own row, `findOrCreate` only
--                              merges signers into NON-terminal envelopes, and
--                              the self-heal creates exactly one row. The one way
--                              to reach it is a retention sweep that destroyed
--                              the signer signatures and did not reach the
--                              envelope — and there the correct action is to
--                              finish the sweep, never to write a signature back
--                              onto rows that were just anonymized. Matching an
--                              email to pick an author would be manufacturing a
--                              fact about who signed.
--
-- THE GUARD BELOW IS THE POINT. Getting this wrong destroys retained legal
-- evidence, so the drop does not run on trust: a CHECK-constrained scratch table
-- takes the count of envelopes whose signature did NOT make it onto a signer
-- row. Zero passes; anything else fails the CHECK, the statement errors, and the
-- migration aborts BEFORE the DROP COLUMN. A deployment holding the unhandled
-- shape gets a failed migration and its data, not a silent loss.
--
-- RETRYABLE. Every statement here is guarded on the value being absent and the
-- ids are derived from the request id rather than random, so a deployment that
-- trips the guard can correct its data and run this again. That is why the
-- `ALTER TABLE ADD COLUMN`s live in the previous migration: they cannot be made
-- conditional, and D1 re-runs a failed migration from its first statement.

-- 1) Exactly one signer row: the signature is that person's.
UPDATE `agreement_signers`
SET `signature_base64`   = (SELECT r.`signature_base64` FROM `agreement_requests` r WHERE r.`id` = `agreement_signers`.`request_id`),
    `signed_at`          = COALESCE(`signed_at`, (SELECT r.`signed_at` FROM `agreement_requests` r WHERE r.`id` = `agreement_signers`.`request_id`)),
    `status`             = 'signed',
    `attribution_basis`  = 'relocated_single_signer',
    `attribution_source` = 'agreement_requests.signature_base64 (sole signer row of the envelope)',
    `attributed_at`      = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE `signature_base64` IS NULL
  AND EXISTS (SELECT 1 FROM `agreement_requests` r WHERE r.`id` = `agreement_signers`.`request_id` AND r.`signature_base64` IS NOT NULL)
  AND (SELECT COUNT(*) FROM `agreement_signers` s2 WHERE s2.`request_id` = `agreement_signers`.`request_id`) = 1;
--> statement-breakpoint

-- 2) Zero signer rows: synthesize the client signer the envelope always implied.
--    token_hash / token_enc stay NULL — this row carries evidence, not a link.
--    The identity is DERIVED from the envelope's recipient fields, and says so.
--    The `backfill:` id prefix keeps these rows identifiable forever.
INSERT INTO `agreement_signers`
  (`id`, `tenant_id`, `request_id`, `name`, `email`, `role`, `status`, `signature_base64`, `signed_at`, `created_at`,
   `attribution_basis`, `attribution_source`, `attributed_at`)
SELECT
  'backfill:' || r.`id`,
  r.`tenant_id`,
  r.`id`,
  COALESCE(NULLIF(r.`client_name`, ''), NULLIF(r.`client_email`, ''), 'Client'),
  COALESCE(r.`client_email`, ''),
  'client',
  'signed',
  r.`signature_base64`,
  r.`signed_at`,
  r.`created_at`,
  'relocated_envelope_recipient',
  'agreement_requests.signature_base64; identity from agreement_requests.client_name/client_email',
  CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `agreement_requests` r
WHERE r.`signature_base64` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `agreement_signers` s WHERE s.`request_id` = r.`id`);
--> statement-breakpoint

-- 3) Fail closed. Any envelope signature that did not land on a signer row
--    aborts the migration here, before anything is dropped.
DROP TABLE IF EXISTS `_signature_backfill_guard`;
--> statement-breakpoint
CREATE TABLE `_signature_backfill_guard` (`orphaned_signatures` INTEGER NOT NULL CHECK (`orphaned_signatures` = 0));
--> statement-breakpoint
INSERT INTO `_signature_backfill_guard` (`orphaned_signatures`)
SELECT COUNT(*) FROM `agreement_requests` r
WHERE r.`signature_base64` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `agreement_signers` s WHERE s.`request_id` = r.`id` AND s.`signature_base64` IS NOT NULL);
--> statement-breakpoint
DROP TABLE `_signature_backfill_guard`;
--> statement-breakpoint

-- 4) The column is now redundant everywhere it was read.
ALTER TABLE `agreement_requests` DROP COLUMN `signature_base64`;
