-- Fifteen indexes whose column list is a strict PREFIX of a wider index on the
-- same table.
--
-- SQLite can seek a composite index on any leading subset of its columns, so a
-- narrow index sitting in front of a wider one serves no query the wider one
-- cannot. What it does do is cost one more b-tree write per INSERT - billed, on
-- D1, in rows_written.
--
-- The prior round dropped only the two indexes whose column lists were
-- IDENTICAL to a neighbouring unique index, and deliberately left these fifteen
-- alone on the grounds that a narrower index is cheaper to SCAN and the planner
-- sometimes prefers it - a claim that deserved a measurement rather than a
-- deduction. Here is the measurement. Each index was dropped from a database
-- built from this migration chain and the plan for a seek on its own columns was
-- re-read ON A FRESH CONNECTION (sqlite reuses a prepared statement across a
-- DROP INDEX, so the same connection keeps naming an index that no longer
-- exists - the first attempt at this produced exactly that false result).
--
-- All fifteen still resolve to an index SEEK. None degrades to a table scan.
-- The index that takes the query over:
--
--   idx_ai_content_reviews_tenant_artifact  ->  uq_ai_content_reviews_person_call
--   idx_availability_inspector              ->  idx_availability_window_unique
--   idx_avail_overrides_insp                ->  uq_avail_overrides_external
--   idx_contacts_tenant                     ->  idx_contacts_type
--   idx_ip_inspection                       ->  uq_ip_insp_contact_role
--   idx_inspections_tenant                  ->  idx_inspections_tenant_created
--   idx_inspections_inspector               ->  idx_inspections_inspector_date
--   idx_inspector_service_areas_tenant      ->  uq_inspector_service_areas
--   idx_inspector_service_areas_user        ->  uq_inspector_service_areas
--   idx_invoices_tenant                     ->  idx_invoices_contact
--   idx_notification_prefs_subject          ->  idx_notification_prefs_unique
--   idx_rating_systems_tenant               ->  idx_rating_systems_tenant_slug
--   idx_tags_tenant                         ->  idx_tags_tenant_name
--   idx_tenant_library_imports_tenant       ->  uq_tenant_library_import
--   idx_users_tenant                        ->  idx_users_slug_per_tenant
--
-- What the measurement does NOT establish: it reads plan SHAPE on empty tables
-- with no ANALYZE statistics, so it says "the wider index is usable", not "the
-- cost is identical at scale". At this deployment's size - a low-tens-of-rows
-- database - the read-side page difference is unmeasurable and the write-side
-- saving is every insert. If a table ever grows enough for the difference to
-- matter, the answer is a new index chosen against real statistics, not these.

DROP INDEX `idx_ai_content_reviews_tenant_artifact`;--> statement-breakpoint
DROP INDEX `idx_availability_inspector`;--> statement-breakpoint
DROP INDEX `idx_avail_overrides_insp`;--> statement-breakpoint
DROP INDEX `idx_contacts_tenant`;--> statement-breakpoint
DROP INDEX `idx_ip_inspection`;--> statement-breakpoint
DROP INDEX `idx_inspections_tenant`;--> statement-breakpoint
DROP INDEX `idx_inspections_inspector`;--> statement-breakpoint
DROP INDEX `idx_inspector_service_areas_tenant`;--> statement-breakpoint
DROP INDEX `idx_inspector_service_areas_user`;--> statement-breakpoint
DROP INDEX `idx_invoices_tenant`;--> statement-breakpoint
DROP INDEX `idx_notification_prefs_subject`;--> statement-breakpoint
DROP INDEX `idx_rating_systems_tenant`;--> statement-breakpoint
DROP INDEX `idx_tags_tenant`;--> statement-breakpoint
DROP INDEX `idx_tenant_library_imports_tenant`;--> statement-breakpoint
DROP INDEX `idx_users_tenant`;
