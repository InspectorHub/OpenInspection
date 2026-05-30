-- 0006_verification_token.sql
-- Spec 5H P2 — opaque, read-only token embedded in /v/:token public verifier
-- URL and QR codes on signed PDFs. Distinct from the write-permission token
-- in agreement_requests.token (that one grants sign access).
ALTER TABLE agreement_requests ADD COLUMN verification_token TEXT;
CREATE UNIQUE INDEX idx_agreement_requests_verify_token
  ON agreement_requests(verification_token) WHERE verification_token IS NOT NULL;
