-- Agent Accounts A2 — Migration 0057
-- Per-user notification preference flags consumed by EmailService when an agent
-- recipient is involved. Default ON for referral + report (high signal), OFF
-- for paid (high noise; the inspector can forward the receipt manually).
--
-- Used by:
--   - EmailService.sendNewReferral   -> gated on notify_on_referral
--   - EmailService.sendReportReady   -> gated on notify_on_report (agent recipient only)
--   - EmailService.sendInvoicePaid   -> gated on notify_on_paid
--   - /agent-settings/profile        -> three toggles persist via POST /api/agent/profile

ALTER TABLE users ADD COLUMN notify_on_referral INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_on_report   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_on_paid     INTEGER NOT NULL DEFAULT 0;
