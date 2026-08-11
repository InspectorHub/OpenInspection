-- Backfill the per-inspection template snapshot for rows that name a template
-- but carry no snapshot (#307 Task 7).
--
-- WHY THIS MUST RUN BEFORE the fallback is retired: `requireTemplateSnapshot`
-- throws when `template_id` is set and `template_snapshot` is NULL, and
-- `computePublishReadiness` calls it — which `getInspectionHub` composes. So a
-- single such row does not merely break its report, it 500s the whole
-- inspection hub page for that inspection. Verified against production before
-- writing this: 24 inspections, 6 with no snapshot, 4 of those naming a
-- template. The other 2 name no template and are correctly left alone — a
-- template-less inspection never had a structure, and the helper returns empty
-- sections for it rather than throwing.
--
-- ⚠️ WHAT THIS TRADES AWAY, recorded because it is not recoverable later.
-- This copies the template's schema AS IT IS TODAY. That is not necessarily the
-- structure the inspector actually filled in: if the template was edited after
-- those inspections were completed, the restored structure is the newer one.
-- All four affected rows are `completed`/`published`, so this is being written
-- onto finished work.
--
-- The faithful alternative was considered and does not exist. The design
-- assumed the true structure could be recovered from each row's signed
-- `report_versions` snapshot; in production 3 of the 4 have NO report_versions
-- row at all, so there is nothing faithful to recover. The remaining choice was
-- between today's schema and leaving them NULL, and leaving them NULL is the
-- option that 500s a page. This was a human decision taken with those numbers
-- in hand.
--
-- Idempotent: the WHERE clause stops matching a row once its snapshot is set,
-- so a re-run is a no-op. Guarded by EXISTS so a row naming a template that no
-- longer exists is left NULL rather than being set to NULL again — such a row
-- would still throw, which is correct: there is genuinely nothing to restore.
UPDATE inspections
SET template_snapshot = (
      SELECT t.schema FROM templates t
       WHERE t.id = inspections.template_id
         AND t.tenant_id = inspections.tenant_id
    ),
    template_snapshot_version = COALESCE((
      SELECT t.version FROM templates t
       WHERE t.id = inspections.template_id
         AND t.tenant_id = inspections.tenant_id
    ), 1)
WHERE template_snapshot IS NULL
  AND template_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM templates t
       WHERE t.id = inspections.template_id
         AND t.tenant_id = inspections.tenant_id
  );
