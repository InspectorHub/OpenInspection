-- Secret UI化: move 14 integration API keys from Worker env secrets to
-- encrypted DB storage. The column stores an AES-256-GCM ciphertext blob
-- produced by config-crypto.ts (KDF from JWT_SECRET). NULL until the
-- tenant admin saves at least one key via Settings → Integrations.
ALTER TABLE tenant_configs ADD COLUMN encrypted_secrets TEXT;
