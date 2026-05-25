-- Booking #7 Sprint A — per-inspector booking slug
-- Adds users.slug (per-tenant unique) + slug_reservations blacklist seeded with
-- reserved route names so customers can't claim e.g. /book/admin.

ALTER TABLE users ADD COLUMN slug TEXT;

CREATE UNIQUE INDEX idx_users_slug_per_tenant
    ON users(tenant_id, slug)
    WHERE slug IS NOT NULL;

CREATE TABLE slug_reservations (
    slug TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_at INTEGER NOT NULL
);

INSERT INTO slug_reservations (slug, reason, blocked_at) VALUES
    ('admin', 'reserved-route', strftime('%s','now')),
    ('api', 'reserved-route', strftime('%s','now')),
    ('book', 'reserved-route', strftime('%s','now')),
    ('r', 'reserved-route', strftime('%s','now')),
    ('report', 'reserved-route', strftime('%s','now')),
    ('settings', 'reserved-route', strftime('%s','now')),
    ('login', 'reserved-route', strftime('%s','now')),
    ('logout', 'reserved-route', strftime('%s','now')),
    ('dashboard', 'reserved-route', strftime('%s','now')),
    ('library', 'reserved-route', strftime('%s','now')),
    ('inspections', 'reserved-route', strftime('%s','now')),
    ('inspection', 'reserved-route', strftime('%s','now')),
    ('calendar', 'reserved-route', strftime('%s','now')),
    ('contacts', 'reserved-route', strftime('%s','now')),
    ('invoices', 'reserved-route', strftime('%s','now')),
    ('messages', 'reserved-route', strftime('%s','now')),
    ('sign', 'reserved-route', strftime('%s','now')),
    ('agreement-sign', 'reserved-route', strftime('%s','now')),
    ('not-found', 'reserved-route', strftime('%s','now')),
    ('sysadmin', 'reserved-route', strftime('%s','now')),
    ('health', 'reserved-route', strftime('%s','now')),
    ('embed', 'reserved-route', strftime('%s','now')),
    ('inspector', 'reserved-route', strftime('%s','now')),
    ('static', 'reserved-route', strftime('%s','now')),
    ('public', 'reserved-route', strftime('%s','now'));
