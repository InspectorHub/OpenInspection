-- Assert that no signature evidence was lost. Changes nothing; fails closed.
--
-- WHY THIS EXISTS. Counsel's full review of round 16 (2026-08-15) pointed out
-- that the relocation migration checked only ONE invariant — that no envelope
-- signature failed to reach a signer row — and that this is not the same as
-- checking that no evidence was lost. Their words: "不要只验证'没有 ambiguous
-- rows'，还要验证'没有 evidence loss'。这是两个不同的 invariant。"
--
-- They are right that the two differ, and the second is the one a reader of the
-- database in five years will care about. So it is stated here as a standing
-- post-condition rather than as a one-time check inside the migration that
-- performed the move: this way it re-runs for every deployment, it catches
-- evidence loss whatever caused it, and it did not require hand-editing a
-- migration that had already been applied.
--
-- THE INVARIANT. A signed agreement that has not been purged must have at least
-- one signer row carrying a signature. If it does not, the document that
-- evidences that signing has nothing behind it — which is exactly the condition
-- the relocation was supposed to make impossible, and exactly the condition a
-- botched or partial migration would produce.
--
-- `purged_at IS NOT NULL` is excluded on purpose and is not a loophole: the GDPR
-- retention sweep destroys the signature past its window and stamps that column
-- as the record of having done so. An envelope with no signature AND no purge
-- marker is unexplained, which is the case worth stopping for.
--
-- WHAT HAPPENS ON FAILURE. The CHECK rejects the insert, the statement errors,
-- and the migration does not complete. Nothing is written, nothing is dropped,
-- and the operator has their data plus a reason to look. Do NOT resolve a
-- failure by writing a signature onto a signer row to satisfy the check — that
-- manufactures the evidence the check exists to find missing, and counsel
-- prohibited exactly that in round 18.
--
-- Verified against production before this was committed: 1 signed envelope,
-- 0 purged, 1 signature held, 0 unexplained.
DROP TABLE IF EXISTS `_signature_evidence_guard`;--> statement-breakpoint
CREATE TABLE `_signature_evidence_guard` (`unexplained_signed_envelopes` INTEGER NOT NULL CHECK (`unexplained_signed_envelopes` = 0));--> statement-breakpoint
INSERT INTO `_signature_evidence_guard` (`unexplained_signed_envelopes`)
SELECT COUNT(*) FROM `agreement_requests` r
WHERE r.`status` = 'signed'
  AND r.`purged_at` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `agreement_signers` s
    WHERE s.`request_id` = r.`id` AND s.`signature_base64` IS NOT NULL
  );--> statement-breakpoint
DROP TABLE `_signature_evidence_guard`;
