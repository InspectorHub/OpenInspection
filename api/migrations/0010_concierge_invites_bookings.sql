CREATE TABLE concierge_invites (
    token TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    inspector_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE concierge_bookings (
    id TEXT PRIMARY KEY,
    confirmation_token TEXT UNIQUE NOT NULL,
    tenant_id TEXT NOT NULL,
    invite_token TEXT NOT NULL,
    slot_start TEXT NOT NULL,
    slot_end TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT,
    address TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
