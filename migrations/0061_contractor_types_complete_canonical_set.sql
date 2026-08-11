-- Complete the 22-row canonical contractor-type set for every tenant, ONCE.
-- Twelve DEFECT_TRADES had no contractor type in any tenant, so the trade
-- vocabulary and the contractor-type list could not align at all -- an inspector
-- could not recommend an arborist.
--
-- Deliberately a migration and not `POST /api/integration/seed-starter-content`,
-- which would insert exactly these rows: re-seed is a live endpoint a tenant can
-- trigger repeatedly, and this completion must happen exactly once. The same
-- change adds a delete disclosure, and a completion that ran again would restore
-- types a tenant had deliberately deleted. Safe only because no tenant has
-- deleted a seeded type yet -- verified, not assumed, before this was written.
--
-- Names and sort orders are the fixture's own output
-- (`server/services/starter-content/fixtures/contractor-types.ts`), reproduced
-- exactly, so a later re-seed cannot disagree with this migration. Note
-- `HVAC Technician` and `Mold-remediation Specialist`: the fixture leaves an
-- already-capitalised word alone rather than title-casing it.
--
-- NOT EXISTS keys on the SLUG, never the name. A tenant that renamed its plumber
-- still HAS that trade; keying on the name would hand it a second one. Which is
-- also what makes a second run a no-op.
--
-- Ids are RFC-4122 v4 UUIDs built in SQL rather than literal ids emitted from a
-- script. Literal ids would have to name the tenants that existed the day this
-- was written, making the migration a no-op for every self-hosted install and
-- for every tenant created between authoring and apply.
--
-- ⚠️ REWRITTEN from one INSERT with a 12-term UNION ALL to twelve guarded
-- INSERTs. The compound form was verified against a better-sqlite3 harness and
-- passed, then failed on the real D1 path with
--     too many terms in compound SELECT: SQLITE_ERROR
-- D1's SQLite is built with a far lower SQLITE_MAX_COMPOUND_SELECT than the
-- stock 500. A multi-row VALUES clause is no escape: SQLite implements it AS a
-- compound SELECT, so it would hit the same ceiling. Twelve statements have no
-- compound at all. Each keeps its own NOT EXISTS, so idempotence is per-row
-- rather than all-or-nothing.

INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Mold-remediation Specialist',
    7,
    'mold-remediation-specialist',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'mold-remediation-specialist');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Septic Contractor',
    8,
    'septic-contractor',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'septic-contractor');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Arborist',
    11,
    'arborist',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'arborist');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Garage-door Technician',
    12,
    'garage-door-technician',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'garage-door-technician');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Appliance Technician',
    13,
    'appliance-technician',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'appliance-technician');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Waterproofing Contractor',
    14,
    'waterproofing-contractor',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'waterproofing-contractor');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Qualified Mason',
    15,
    'mason',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'mason');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Landscaper',
    16,
    'landscaper',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'landscaper');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Painter',
    17,
    'painter',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'painter');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Flooring Contractor',
    18,
    'flooring-contractor',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'flooring-contractor');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Glazier',
    19,
    'glazier',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'glazier');
--> statement-breakpoint
INSERT INTO contractor_types (id, tenant_id, name, sort_order, trade_slug, created_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', (abs(random()) % 4) + 1, 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    t.id,
    'Qualified Handyman',
    20,
    'qualified-handyman',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM tenants t
 WHERE NOT EXISTS (
       SELECT 1 FROM contractor_types c
        WHERE c.tenant_id = t.id AND c.trade_slug = 'qualified-handyman');
