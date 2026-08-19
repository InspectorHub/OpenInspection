-- Map and complete `contractor_types.trade_slug` for workspaces that already existed.
--
-- WHAT WAS LEFT UNDONE. `trade_slug` is already in the table (see
-- `0000_baseline.sql`) and the seed that fills it in — `CONTRACTOR_TYPES`,
-- derived from `DEFECT_TRADES` — only ever runs for a workspace being created.
-- Every workspace older than that column still carries the ten hand-written
-- names from before the two vocabularies were aligned: eight of them ARE
-- canonical trades and none of them says so, and twelve trades have no row at
-- all. The visible consequence is that a defect tagged
-- `mold-remediation-specialist` renders that trade in the report while the
-- repair-item dropdown cannot offer it, so the inspector invents their own
-- wording for a concept the system already has a name for.
--
-- WHY A MIGRATION AND NOT THE RE-SEED ENDPOINT. `POST /api/integration/seed-starter-content`
-- would insert the missing canonical rows — its skip check is keyed on the slug
-- for exactly that reason. It is still the wrong vehicle: re-seed is a live path
-- a tenant can trigger repeatedly, and this completion must happen once. A
-- delete guard is landing on the same table; a completion that ran repeatedly
-- would quietly undo deliberate deletions.
--
-- ⚠️ TWO KINDS OF NULL, and only one of them is being filled. `Foundation
-- Specialist` and `Grading/Drainage` have no counterpart in the canonical
-- vocabulary and are tenant-visible data an inspector uses. They keep a NULL
-- slug permanently, and this migration must not touch them or delete them. So
-- must every type a tenant created themselves. NULL here means "no canonical
-- counterpart", never "not backfilled yet".
--
-- ⚠️ WHY EVERY STATEMENT CARRIES A `NOT EXISTS` GUARD RATHER THAN TRUSTING THE
-- INDEX. `uq_contractor_types_tenant_trade` is unique on (tenant_id, trade_slug)
-- where the slug is not null, and the schema's comment is right that a backfill
-- SHOULD fail rather than silently duplicate. But "fail" for a migration is not
-- a rejected row: `d1 migrations apply` dies and every later migration in the
-- chain is blocked. A workspace holding both a seeded `Licensed Electrician`
-- and a hand-created `Our Sparky` already carrying `licensed-electrician` is
-- precisely that case. Production cannot hit it — every tenant carries the
-- untouched ten — but a self-hosted install has arbitrary tenant-authored names
-- and no such pin. The guards make such a workspace a SKIP; the index stays as
-- the backstop for anything that reaches an insert some other way.
--
-- ⚠️ A SKIPPED ROW IS NOT SILENTLY FINE — it is a workspace with two types for
-- one trade where this migration declined to choose. After applying, list them:
--
--   SELECT tenant_id, name FROM contractor_types
--    WHERE trade_slug IS NULL
--      AND name IN ('Licensed Electrician', 'Plumber', 'Roofer', 'HVAC Technician',
--                   'General Contractor', 'Structural Engineer', 'Chimney Sweep',
--                   'Pest/Termite');
--
-- Anything returned needs a human decision, not a re-run.
--
-- `MIN(id) … GROUP BY tenant_id` picks at most one row per workspace per trade.
-- Without it, a workspace that happens to hold two rows named `Plumber` would
-- have both updated by one statement and collide with the index mid-flight —
-- the same chain-killing failure the guards exist to avoid.
--
-- Names and sort orders for the inserted rows are reproduced from
-- `server/services/starter-content/fixtures/contractor-types.ts`, not invented
-- here; `tests/unit/db/contractor-type-trade-slug-backfill.spec.ts` asserts they
-- match, so a re-seed after this cannot produce a second row for one trade under
-- a different label. Pre-existing rows keep their own `sort_order`: that is the
-- tenant's ordering and not ours to renumber.

-- ── 1. The five whose stored names already read correctly: stamp only. ──────
UPDATE `contractor_types` SET `trade_slug` = 'general-contractor'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'General Contractor'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'general-contractor')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint
UPDATE `contractor_types` SET `trade_slug` = 'licensed-electrician'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'Licensed Electrician'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'licensed-electrician')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint
UPDATE `contractor_types` SET `trade_slug` = 'hvac-technician'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'HVAC Technician'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'hvac-technician')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint
UPDATE `contractor_types` SET `trade_slug` = 'structural-engineer'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'Structural Engineer'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'structural-engineer')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint
UPDATE `contractor_types` SET `trade_slug` = 'chimney-sweep'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'Chimney Sweep'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'chimney-sweep')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint

-- ── 2. The three whose wording differs: stamp AND adopt the canonical label. ─
-- Safe because `comments.recommended_contractor_type_id` stores the id, not the
-- name, and the row keeps its id — asserted by the spec rather than trusted.
-- The rename is what stops an existing workspace reading `Plumber` next to a
-- freshly inserted `Qualified Handyman` from two different generations of the
-- same list.
UPDATE `contractor_types` SET `trade_slug` = 'licensed-plumber', `name` = 'Licensed Plumber'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'Plumber'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'licensed-plumber')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint
UPDATE `contractor_types` SET `trade_slug` = 'licensed-roofer', `name` = 'Licensed Roofer'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'Roofer'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'licensed-roofer')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint
UPDATE `contractor_types` SET `trade_slug` = 'pest-control', `name` = 'Pest-control Professional'
 WHERE `id` IN (SELECT MIN(c.`id`) FROM `contractor_types` c
                 WHERE c.`trade_slug` IS NULL AND c.`name` = 'Pest/Termite'
                   AND NOT EXISTS (SELECT 1 FROM `contractor_types` x
                                    WHERE x.`tenant_id` = c.`tenant_id` AND x.`trade_slug` = 'pest-control')
                 GROUP BY c.`tenant_id`);
--> statement-breakpoint

-- ── 3. Insert every canonical trade a workspace still has no row for. ───────
-- Keyed on the SLUG, never on the name: a workspace that renamed its plumber to
-- `Our Guy Dave` still HAS that trade, and matching on the name would hand it a
-- second one. The two extras are deliberately absent from this list — they carry
-- no slug, so nothing here could tell a re-run apart from a first run for them.
-- The id expression is a real v4 UUID (version nibble `4`, variant `89ab`) so
-- these rows are indistinguishable from ones `crypto.randomUUID()` minted.
--
-- ⚠️ ONE STATEMENT PER TRADE, AND IT MUST STAY THAT WAY. The obvious shape is a
-- single INSERT over a twenty-row `UNION ALL` list, and it was written that way
-- first: it passes every unit test in this repository and D1 REFUSES IT with
-- `too many terms in compound SELECT`. D1 caps SQLITE_MAX_COMPOUND_SELECT well
-- below the SQLite default, and the better-sqlite3 the unit suite runs on does
-- not — so the tests cannot see this and only applying the migration can. Do not
-- consolidate these back into a compound SELECT or a multi-row VALUES list.
--
-- A tenant with no contractor types at all gets the canonical twenty and not the
-- two extras. That is deliberate: the extras carry no slug, so re-running this
-- could not tell whether it had already inserted them. The seeder still covers
-- them for a workspace being created.
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'General Contractor', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'general-contractor'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'general-contractor');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Licensed Electrician', 2, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'licensed-electrician'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'licensed-electrician');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Licensed Plumber', 3, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'licensed-plumber'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'licensed-plumber');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Licensed Roofer', 4, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'licensed-roofer'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'licensed-roofer');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'HVAC Technician', 5, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'hvac-technician'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'hvac-technician');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Structural Engineer', 6, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'structural-engineer'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'structural-engineer');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Mold-remediation Specialist', 7, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'mold-remediation-specialist'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'mold-remediation-specialist');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Septic Contractor', 8, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'septic-contractor'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'septic-contractor');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Chimney Sweep', 9, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'chimney-sweep'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'chimney-sweep');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Pest-control Professional', 10, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'pest-control'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'pest-control');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Arborist', 11, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'arborist'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'arborist');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Garage-door Technician', 12, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'garage-door-technician'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'garage-door-technician');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Appliance Technician', 13, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'appliance-technician'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'appliance-technician');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Waterproofing Contractor', 14, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'waterproofing-contractor'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'waterproofing-contractor');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Qualified Mason', 15, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'mason'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'mason');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Landscaper', 16, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'landscaper'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'landscaper');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Painter', 17, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'painter'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'painter');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Flooring Contractor', 18, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'flooring-contractor'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'flooring-contractor');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Glazier', 19, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'glazier'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'glazier');
--> statement-breakpoint
INSERT INTO `contractor_types` (`id`, `tenant_id`, `name`, `sort_order`, `created_at`, `trade_slug`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       t.`id`, 'Qualified Handyman', 20, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'qualified-handyman'
  FROM `tenants` t
 WHERE NOT EXISTS (SELECT 1 FROM `contractor_types` c
                    WHERE c.`tenant_id` = t.`id` AND c.`trade_slug` = 'qualified-handyman');
