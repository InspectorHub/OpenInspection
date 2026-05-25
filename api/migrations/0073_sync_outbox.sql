-- 2026-05-23 — Outbox table for core → portal sync events
--
-- Captures user lifecycle events (invite accepted, password changed,
-- user removed) so an asynchronous flush worker can deliver them to
-- portal's /api/integration/from-core endpoint. Outbox semantics give
-- us atomicity (mutation + event row in one DB transaction) without
-- requiring cross-DB transactions.
--
-- Flush worker behaviour:
--   - reads `status = 'pending'` rows ordered by created_at, batch size 50
--   - posts each event to portal (HMAC-signed)
--   - on 2xx → status = 'done', last_tried_at = now
--   - on 4xx → status = 'failed', last_error = body (these need manual
--     intervention; usually a schema mismatch or a bad event payload)
--   - on 5xx / network → attempts++, last_tried_at = now, last_error
--     set; stays 'pending'; backoff in worker (don't retry the same row
--     more often than once per minute)
--
-- Portal deduplicates by `id` (the outbox row id is also the
-- sync_event_id forwarded in the HMAC body), so the worker is free to
-- retry pending rows at will without producing duplicate mutations.

CREATE TABLE sync_outbox (
    id              TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,                       -- 'user.invited' | 'user.password_changed' | 'user.deleted' | ...
    payload         TEXT NOT NULL,                       -- JSON-encoded event-specific payload
    status          TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'done' | 'failed'
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    last_tried_at   INTEGER,
    last_error      TEXT
);

CREATE INDEX idx_sync_outbox_status_created
    ON sync_outbox(status, created_at)
    WHERE status = 'pending';
