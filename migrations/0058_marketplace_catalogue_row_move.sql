-- The legacy template catalogue's rows move onto the unified catalogue as
-- kind='templates' (#293). Ids carry over unchanged, so nothing has to be
-- re-keyed and every existing reference still resolves.
--
-- `category` did NOT come across as one column. It was free text spanning a
-- property type, a jurisdiction's form standard and an inspection kind, so it
-- splits into three independent browse axes. property_type is constrained to the
-- template validator's enum ('single-family' | 'multi-unit' | 'commercial'),
-- because a catalogue template exists to BECOME a local `templates` row and a
-- second vocabulary could not survive the import. It is NEVER the wizard's
-- five-value underscore vocabulary.
--
-- ── The classification, as a one-time human pass ──────────────────────────────
-- Five source values generalise to nothing, so this is a judgement recorded once,
-- not an algorithm. Verified against the 12 production rows:
--
--   category         | rows | property_type   | jurisdiction | inspection_kind
--   -----------------+------+-----------------+--------------+-----------------
--   residential      |    7 | single-family   | NULL         | NULL
--   new_construction |    2 | single-family   | NULL         | new_construction
--   trec             |    1 | single-family   | trec         | NULL
--   condo            |    1 | multi-unit      | NULL         | NULL
--   commercial       |    1 | commercial      | NULL         | NULL
--
-- The three judgement calls, and what each one trades away:
--
-- `condo` (Condominium Inspection) → multi-unit. The template enum has no
-- `condo`; the wizard's enum does, and that mismatch is exactly why the two are
-- not reconciled here. A condo is one dwelling inside a building of many, so it
-- is neither cleanly single-family nor cleanly multi-unit. `single-family` would
-- be actively false — a condo is definitionally not one. NULL would say "this row
-- does not commit to a property type", which is a different and untrue claim: the
-- row commits precisely, the enum just cannot express it, and with a catalogue
-- this small a row invisible to every filtered browse is close to a row that is
-- not there. So: multi-unit, trading away the distinction between inspecting ONE
-- unit and inspecting the WHOLE building. A browse for multi-unit now returns
-- both, which is over-broad rather than wrong. That lost distinction is the
-- concrete argument for whoever later reconciles the two property-type enums.
--
-- `new_construction` (Final Walkthrough, Pre-Drywall) → single-family, judged
-- from the names and from the residential seed they ship alongside; phase
-- inspections in this market are overwhelmingly on single-family builds. This is
-- the weakest of the three calls — it is judged from the name, not from the
-- template body — and it is the first thing to correct if a body says otherwise.
-- new_construction itself is an inspection KIND, not a property type: it says
-- what stage is being inspected, which is orthogonal to what is being inspected.
--
-- `trec` (TREC REI 7-6) → jurisdiction 'trec', property_type single-family. TREC
-- is a Texas form standard, not a property type. The form's own scope is
-- one-to-four family dwellings, which straddles single-family and multi-unit; the
-- enum cannot say "one to four", so this takes the dominant use and trades away
-- discoverability for the 2-4 unit case.
--
-- ── Idempotence ──────────────────────────────────────────────────────────────
-- Guarded by NOT EXISTS on the id, so a re-run is a no-op and this cannot
-- duplicate the catalogue. The dedup key is the id and never the name: two rows
-- in this catalogue are two generations of one seed under different names, and
-- name-keying is the defect this whole work item exists to stop repeating.
--
-- The axis derivation keys on `category` rather than on a list of production ids,
-- so this migration is correct on a self-hosted install whose ids differ from
-- SaaS production's. A CASE over ids read out of one database is a no-op
-- everywhere else.
INSERT INTO marketplace_libraries
  (id, name, kind, semver, schema, author_id, changelog, download_count, is_featured,
   created_at, updated_at, property_type, jurisdiction, inspection_kind)
SELECT
  mt.id, mt.name, 'templates', mt.semver, mt.schema, mt.author_id, mt.changelog,
  mt.download_count, mt.is_featured, mt.created_at, mt.updated_at,
  CASE mt.category
    WHEN 'residential'      THEN 'single-family'
    WHEN 'new_construction' THEN 'single-family'
    WHEN 'trec'             THEN 'single-family'
    WHEN 'condo'            THEN 'multi-unit'
    WHEN 'commercial'       THEN 'commercial'
  END,
  CASE mt.category WHEN 'trec'             THEN 'trec'             END,
  CASE mt.category WHEN 'new_construction' THEN 'new_construction' END
FROM marketplace_templates mt
WHERE NOT EXISTS (SELECT 1 FROM marketplace_libraries ml WHERE ml.id = mt.id);
