-- Round-2 backlog #10 — block-report tenant policy.
-- Adds two opt-in flags to tenant_configs so new inspections inherit
-- gating defaults for the Sprint 1 D-7 ReportGatePage paywall.
ALTER TABLE tenant_configs
  ADD COLUMN block_unpaid INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tenant_configs
  ADD COLUMN block_unsigned_agreement INTEGER NOT NULL DEFAULT 0;
