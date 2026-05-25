-- Agent Accounts A3 — Migration 0058
-- Concierge booking: agents create draft inspections on behalf of clients.
-- Per-tenant flag toggles between auto-confirm (HomeGauge-style; magic-link to
-- client) and reviewer mode (Spectora-style; inspector approves first).

-- 1. inspections.concierge_status — state machine column.
--      NULL                 => not a concierge booking (or already settled).
--      'awaiting_inspector' => agent submitted, inspector must approve (reviewer mode).
--      'awaiting_client'    => inspector approved (or auto in default mode); waiting on client magic-link confirm.
ALTER TABLE inspections ADD COLUMN concierge_status TEXT
    CHECK (concierge_status IN ('awaiting_client','awaiting_inspector') OR concierge_status IS NULL);

-- 2. tenant_configs.concierge_review_required — per-tenant toggle. Default OFF
--    matches HomeGauge auto-confirm behavior. ON enables Spectora reviewer mode.
ALTER TABLE tenant_configs ADD COLUMN concierge_review_required INTEGER NOT NULL DEFAULT 0;

-- 3. Magic-link tokens. 7-day TTL; single-use (confirmed_at flips when redeemed).
CREATE TABLE concierge_confirm_tokens (
    token         TEXT    PRIMARY KEY,
    inspection_id TEXT    NOT NULL REFERENCES inspections(id),
    tenant_id     TEXT    NOT NULL,
    client_email  TEXT    NOT NULL,
    expires_at    INTEGER NOT NULL,
    confirmed_at  INTEGER,
    created_at    INTEGER NOT NULL
);

CREATE INDEX idx_concierge_tokens_expiry ON concierge_confirm_tokens(expires_at);
