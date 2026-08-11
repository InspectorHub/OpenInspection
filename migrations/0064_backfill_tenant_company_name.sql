-- Give every tenant a company name of its own, before `tenants.name` is dropped.
--
-- This migration exists because of a measurement, not a tidiness urge. Against
-- production on 2026-08-11, of 16 tenants: 11 already carry the same name in
-- both places, 1 has deliberately diverged (that tenant typed a real company
-- name into settings while its container name is an email local-part), and
-- FOUR have no usable `tenant_configs.company_name` at all. For those four,
-- `tenants.name` is the only name that exists anywhere. Dropping the column
-- without this step would render them blank in the agent directory, in invite
-- emails and on public profiles — a worse outcome than the stale name the whole
-- change set out to fix.
--
-- Two statements because "has a config row whose name is empty" and "has no
-- config row at all" are different writes.
--
-- Whitespace counts as empty. "Set to spaces" and "never set" are the same
-- thing to a reader, and only one of them is NULL — the same NULLIF(TRIM(..))
-- rule the display expression uses, so the backfill fills exactly the set the
-- fallback was covering.
--
-- The diverged tenant is untouched by construction: its company_name is
-- non-blank, so neither statement matches it. Settings keeps winning.
--
-- Idempotent. Re-running matches nothing, because each predicate describes
-- precisely the rows the statement fills.
--
-- `updated_at` is supplied explicitly: it is one of only two NOT NULL columns
-- on this table with no DDL default (the other is the primary key). Verified
-- against the live schema rather than assumed.

UPDATE tenant_configs
   SET company_name = (SELECT t.name FROM tenants t WHERE t.id = tenant_configs.tenant_id),
       updated_at   = unixepoch('now') * 1000
 WHERE (company_name IS NULL OR TRIM(company_name) = '')
   AND EXISTS (
         SELECT 1 FROM tenants t
          WHERE t.id = tenant_configs.tenant_id
            AND TRIM(t.name) <> ''
       );

INSERT INTO tenant_configs (tenant_id, company_name, updated_at)
SELECT t.id, t.name, unixepoch('now') * 1000
  FROM tenants t
 WHERE TRIM(t.name) <> ''
   AND NOT EXISTS (SELECT 1 FROM tenant_configs c WHERE c.tenant_id = t.id);
