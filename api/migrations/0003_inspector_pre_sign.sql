-- 0003_inspector_pre_sign.sql
-- Spec 5H D1 — Inspector can optionally sign an agreement BEFORE sending it
-- to the client. The client signing alone (signatureBase64 + status='signed')
-- remains the legally-meaningful event that triggers SignCompletionWorkflow;
-- these fields just allow the rendered PDF to show both signatures when the
-- inspector chose to pre-sign.
--
-- All NULL-able: pre-sign is purely opt-in.

ALTER TABLE agreement_requests ADD COLUMN inspector_signature_base64 TEXT;
ALTER TABLE agreement_requests ADD COLUMN inspector_signed_at INTEGER;
ALTER TABLE agreement_requests ADD COLUMN inspector_user_id TEXT REFERENCES users(id);
