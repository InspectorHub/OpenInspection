-- Record HOW each signer row came to say that a given signature is a given
-- person's. Structure only: nothing is moved or dropped here.
--
-- WHY (counsel round 16B, 2026-08-15). The next migration relocates retained
-- signature evidence off the envelope and onto signer rows, and one of those
-- cases derives the signer's identity from the envelope's recipient fields
-- rather than reading it from a signing event. A record produced that way is
-- not the same fact as one captured at signing, and the two must stay
-- distinguishable — otherwise a reader years from now takes an attribution we
-- derived for an identity the signing event recorded.
--
--   signing_event                 the signer signed here; the signing endpoint
--                                 wrote the image and the identity together.
--   relocated_single_signer       the signature came off the envelope, and this
--                                 was the envelope's ONLY signer row.
--   relocated_envelope_recipient  the envelope had NO signer rows; the row was
--                                 created for it and the identity comes from the
--                                 envelope's recipient fields.
--
-- SEPARATE FROM THE RELOCATION ON PURPOSE. `ALTER TABLE ADD COLUMN` cannot be
-- made conditional in SQLite, and D1 re-runs a failed migration from its first
-- statement. Keeping the columns here means the relocation that follows is
-- retryable: a deployment whose data trips that migration's guard can fix the
-- data and run it again, instead of hitting `duplicate column name` and never
-- reaching the part that matters. Found by re-running the combined version.
--
-- Appended at the table end — D1 cannot add a column mid-table on a referenced
-- table.
ALTER TABLE `agreement_signers` ADD `attribution_basis` text;--> statement-breakpoint
ALTER TABLE `agreement_signers` ADD `attribution_source` text;--> statement-breakpoint
ALTER TABLE `agreement_signers` ADD `attributed_at` integer;--> statement-breakpoint

-- Every signature already sitting on a signer row was captured there by the
-- signing endpoint — that is the only path that writes one. Saying so
-- explicitly is what lets a NULL basis on any later row read as "not recorded"
-- rather than "captured, probably".
--
-- `attributed_at` takes the signing time, because for a captured signature the
-- attribution and the signature are the same event. Relocated rows will differ:
-- theirs is when the migration ran, which for old evidence is years later.
UPDATE `agreement_signers`
SET `attribution_basis` = 'signing_event',
    `attributed_at`     = `signed_at`
WHERE `signature_base64` IS NOT NULL
  AND `attribution_basis` IS NULL;
