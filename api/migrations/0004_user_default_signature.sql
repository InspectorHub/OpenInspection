-- 0004_user_default_signature.sql
-- Spec 5H D2 — inspector's saved signature image, reused for auto-sign on
-- report publish AND as the default starting state of the SignaturePad in
-- Settings -> Profile.
ALTER TABLE users ADD COLUMN default_signature_base64 TEXT;
